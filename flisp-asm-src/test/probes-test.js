// Regression tests over many small probe files (test/probes/, plus the other .sflisp fixtures).
// Runs without VS Code.
//
// 1. Snapshot: every live-check message and the computed address and length of every line are
//    stored in test/probes/expected.json. Any change of behaviour shows up here. After an
//    intended change, review the diff and update the snapshot:  node test/probes-test.js --update
// 2. With a real qaflisp (found above the project folder or on the PATH):
//    - the computed layout equals qaflisp's listing, line by line;
//    - every line qaflisp reports as an error is also reported by the live check, except a
//      "Phase error" (qaflisp reports it at a later label, the live check at its cause) and the
//      lab instructions MOVE / CMJEQ (deliberately not reported);
//    - one file with every mnemonic and every operand form has the same layout as in qaflisp.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('../src/symbols');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');
const m = require('../src/mnemonics');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const update = process.argv.includes('--update');

const probeDir = path.join(__dirname, 'probes');
const snapshotFile = path.join(probeDir, 'expected.json');
const sources = {};
for (const n of fs.readdirSync(probeDir).filter((f) => f.endsWith('.sflisp')).sort()) sources[`probes/${n}`] = path.join(probeDir, n);
for (const n of fs.readdirSync(__dirname).filter((f) => f.endsWith('.sflisp')).sort()) sources[n] = path.join(__dirname, n);
const exampleDir = path.join(__dirname, 'examples');
for (const n of fs.readdirSync(exampleDir).filter((f) => f.endsWith('.sflisp')).sort()) sources[`examples/${n}`] = path.join(exampleDir, n);
const read = (file) => fs.readFileSync(file, 'utf8');

function snapshotOf(source) {
  const a = analyze(source);
  const diagnostics = a.diagnostics.slice()
    .sort((x, y) => x.line - y.line || x.start - y.start || (x.message < y.message ? -1 : 1))
    .map((d) => `${d.line + 1}:${d.start}-${d.end} ${d.severity}: ${d.message}`);
  const layout = [...a.layout.lines].map(([line, l]) => `${line + 1}: ${l.address} +${l.size}`);
  return { diagnostics, layout, stoppedAt: a.layout.stoppedAt === undefined ? null : a.layout.stoppedAt + 1 };
}

test('snapshot: live-check messages and addresses are unchanged', () => {
  const current = {};
  for (const [name, file] of Object.entries(sources)) current[name] = snapshotOf(read(file));
  if (update || !fs.existsSync(snapshotFile)) {
    fs.writeFileSync(snapshotFile, `${JSON.stringify(current, null, 1)}\n`);
    console.log(`      snapshot written: ${Object.keys(current).length} files`);
    return;
  }
  const expected = JSON.parse(read(snapshotFile));
  const wrong = [];
  for (const name of new Set([...Object.keys(expected), ...Object.keys(current)])) {
    if (!expected[name]) { wrong.push(`${name}: new file, not in the snapshot`); continue; }
    if (!current[name]) { wrong.push(`${name}: in the snapshot, but the file is gone`); continue; }
    for (const key of ['diagnostics', 'layout']) {
      const e = new Set(expected[name][key]);
      const c = new Set(current[name][key]);
      for (const x of e) if (!c.has(x)) wrong.push(`${name} ${key} missing:  ${x}`);
      for (const x of c) if (!e.has(x)) wrong.push(`${name} ${key} new:      ${x}`);
    }
    if (expected[name].stoppedAt !== current[name].stoppedAt) wrong.push(`${name}: layout stops at ${current[name].stoppedAt}, expected ${expected[name].stoppedAt}`);
  }
  assert.deepStrictEqual(wrong, [], 'If the change is intended: node test/probes-test.js --update');
});

// --- Comparison with the real qaflisp ----------------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

// "20 F0 01   17. Start  LDA #1" -> line 16: { address 0x20, bytes 2 } (the listing shows at most 6 bytes)
function readListing(file) {
  const listing = new Map();
  for (const l of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const r = /^([0-9A-F]{2})((?: [0-9A-F]{2})*)\s+(\d+)\.(.*)$/.exec(l);
    if (r) listing.set(+r[3] - 1, { address: parseInt(r[1], 16), bytes: r[2].trim() ? r[2].trim().split(' ').length : 0, text: r[4] });
  }
  return listing;
}

function layoutDifferences(name, source, listing) {
  const wrong = [];
  for (const [line, ours] of analyze(source).layout.lines) {
    const theirs = listing.get(line);
    if (!theirs || /^\s*\S*\s+(EQU|ORG|END)\b/i.test(theirs.text)) continue; // no code; the listing shows the value
    const sizeOk = /\bRMB\b/i.test(theirs.text) || theirs.bytes === Math.min(ours.size, 6); // RMB is listed with one byte
    if ((ours.address & 0xFF) !== theirs.address || !sizeOk) {
      wrong.push(`${name}:${line + 1} ours $${(ours.address & 0xFF).toString(16)}+${ours.size}, qaflisp $${theirs.address.toString(16)}+${theirs.bytes}: ${theirs.text.trim()}`);
    }
  }
  return wrong;
}

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-probes-'));
  const assemble = async (name, source) => {
    const file = path.join(tmp, name.replace(/[\\/]/g, '-'));
    fs.writeFileSync(file, source); // a copy: qaflisp's output files stay out of the repository
    const r = await runQaflisp(realExe, file, { listFile: true, warnings: true });
    return { r, listing: readListing(file.replace(/\.sflisp$/, '.lst')) };
  };

  test('real qaflisp: layout equals the listing, and every qaflisp error is reported live', async () => {
    const wrong = [];
    for (const [name, file] of Object.entries(sources)) {
      const source = read(file);
      const lines = source.split(/\r?\n/);
      const { r, listing } = await assemble(name, source);
      wrong.push(...layoutDifferences(name, source, listing));
      const ours = new Set(analyze(source).diagnostics.map((d) => d.line));
      for (const msg of r.messages.filter((x) => x.severity === 'error')) {
        const line = msg.line - 1;
        if (/^Phase error/.test(msg.message) || /^\S*\s+(MOVE|CMJEQ)\b/i.test(lines[line] || '')) continue;
        if (!ours.has(line)) wrong.push(`${name}:${line + 1} qaflisp "${msg.message}", live check: nothing — ${(lines[line] || '').trim()}`);
      }
    }
    assert.deepStrictEqual(wrong, []);
  });

  // Every mnemonic with every operand form, one per line (invalid combinations take 0 bytes).
  const FORMS = ['', '#$12', '$34', '3,SP', '3,X', 'A,X', ',X+', ',X-', ',+X', ',-X', '3,Y', 'A,Y', ',Y+', ',Y-', ',+Y', ',-Y'];
  const PAIRS = ['A,CC', 'CC,A', 'X,Y', 'Y,X', 'X,SP', 'SP,X', 'Y,SP', 'SP,Y', 'A,X'];
  test('real qaflisp: every mnemonic with every operand form has the layout of the listing', async () => {
    const mnemonics = [...m.INHERENT_FLOW, ...m.INHERENT, ...m.FLOW, ...m.OPERAND_INSTRUCTIONS];
    const lines = ['\tORG\t$00'];
    for (const mn of mnemonics) {
      const forms = mn === 'TFR' || mn === 'EXG' ? [...FORMS, ...PAIRS] : FORMS;
      for (const op of forms) lines.push(`\t${mn}${op ? `\t${op}` : ''}`);
    }
    const source = `${lines.join('\n')}\n`;
    const { listing } = await assemble('all-forms.sflisp', source);
    assert.ok(listing.size > 1000, `only ${listing.size} listing lines`);
    assert.deepStrictEqual(layoutDifferences('all-forms', source, listing), []);
  });

  tests.push(['(cleanup)', () => fs.rmSync(tmp, { recursive: true, force: true })]);
}

(async () => {
  let fails = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      if (name !== '(cleanup)') console.log(`ok    ${name}`);
    } catch (e) {
      fails++;
      console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`);
    }
  }
  if (!realExe) console.log('skip  comparison with qaflisp (qaflisp not found)');
  process.exit(fails ? 1 : 0);
})();
