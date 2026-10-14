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
//    - and the other way round, no live error where qaflisp reports none, except first-pass
//      errors (shown at the ORG/RMB line), a multiple definition (marked on every defining
//      line) and lines after qaflisp's "Phase error" (it reports nothing after it);
//    - one file with every mnemonic and every operand form has the same layout as in qaflisp.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('../src/symbols');
const { inspectBytes } = require('../src/fileBytes');
const { readSource, diagnosticsOf, editorLineOf, splitLines } = require('./source-file');
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
const read = readSource; // bytes, encoding and text as the extension sees them

function snapshotOf(src) {
  const a = analyze(src.source, { encoding: src.encoding });
  const diagnostics = diagnosticsOf(src)
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
  const expected = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
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

test('every live-check message has a kind (code branches on the kind, never on the text)', () => {
  const missing = [];
  for (const [name, file] of Object.entries(sources)) {
    for (const d of diagnosticsOf(read(file))) if (!/^[a-z][A-Za-z0-9]*$/.test(d.kind || '')) missing.push(`${name}:${d.line + 1} ${d.message}`);
  }
  assert.deepStrictEqual(missing, []);
});

// --- Comparison with the real qaflisp ----------------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

// "20 F0 01   17. Start  LDA #1" -> line 16: { address 0x20, bytes 2 } (the listing shows at most 6 bytes)
function readListing(file, editorLine = (n) => n - 1) {
  const listing = new Map();
  for (const l of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const r = /^([0-9A-F]{2})((?: [0-9A-F]{2})*)\s+(\d+)\.(.*)$/.exec(l);
    if (r) listing.set(editorLine(+r[3]), { address: parseInt(r[1], 16), bytes: r[2].trim() ? r[2].trim().split(' ').length : 0, text: r[4] });
  }
  return listing;
}

function layoutDifferences(name, src, listing) {
  const wrong = [];
  const joined = src.info.loneCrLines.length ? src.info.loneCrLines[0] : Infinity; // qaflisp joins the next line to it
  for (const [line, ours] of analyze(src.source, { encoding: src.encoding }).layout.lines) {
    if (line > joined) break;
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
  const assemble = async (name, src) => {
    const file = path.join(tmp, name.replace(/[\\/]/g, '-'));
    fs.writeFileSync(file, src.bytes); // a copy: qaflisp's output files stay out of the repository
    const r = await runQaflisp(realExe, file, { listFile: true, warnings: true });
    const editorLine = editorLineOf(src); // a lone CR joins lines for qaflisp
    for (const m of r.messages) m.line = editorLine(m.line) + 1;
    return { r, listing: readListing(file.replace(/\.sflisp$/, '.lst'), editorLine) };
  };

  test('real qaflisp: layout equals the listing, live errors are where qaflisp reports errors', async () => {
    const wrong = [];
    for (const [name, file] of Object.entries(sources)) {
      const src = read(file);
      const lines = splitLines(src.source);
      const { r, listing } = await assemble(name, src);
      wrong.push(...layoutDifferences(name, src, listing));
      const ours = new Set(diagnosticsOf(src).map((d) => d.line));
      for (const msg of r.messages.filter((x) => x.severity === 'error')) {
        const line = msg.line - 1;
        if (/^Phase error/.test(msg.message) || /^\S*\s+(MOVE|CMJEQ)\b/i.test(lines[line] || '')) continue;
        if (!ours.has(line)) wrong.push(`${name}:${line + 1} qaflisp "${msg.message}", live check: nothing — ${(lines[line] || '').trim()}`);
      }
      // The other way round: no live error where qaflisp has none (a false error misleads students).
      const theirErrors = r.messages.filter((x) => x.severity === 'error');
      const theirs = new Set(theirErrors.map((x) => x.line - 1));
      const phase = theirErrors.find((x) => /^Phase error/.test(x.message)); // qaflisp reports nothing after it
      const live = diagnosticsOf(src).filter((x) => x.severity === 'error');
      for (const d of live) {
        if (phase && d.line >= phase.line - 1) continue;
        if (d.kind === 'pass1') continue; // reported at its cause (ORG/RMB), qaflisp at a later line or not at all
        // reported on every definition, qaflisp on one of them
        if (d.kind === 'multipleDefinition' && live.some((o) => o.kind === d.kind && o.symbol === d.symbol && theirs.has(o.line))) continue;
        if (!theirs.has(d.line)) wrong.push(`${name}:${d.line + 1} live error "${d.message}", qaflisp: no error — ${(lines[d.line] || '').trim()}`);
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
    const src = { source, bytes: Buffer.from(source), encoding: 'utf8', info: inspectBytes(Buffer.from(source)) };
    const { listing } = await assemble('all-forms.sflisp', src);
    assert.ok(listing.size > 1000, `only ${listing.size} listing lines`);
    assert.deepStrictEqual(layoutDifferences('all-forms', src, listing), []);
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
