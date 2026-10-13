// Tests for the address layout (src/layout.js) and the checks that need it. Runs without VS Code.
// The comparison with qaflisp's listing runs only if qaflisp is found (as in qaflisp-test.js).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('../src/symbols');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');
const PROBES = require('./check-probes');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('addresses: branch distance, values with labels, beyond $FF', () => {
  const msgs = (src) => analyze(src).diagnostics.slice().sort((a, b) => a.line - b.line)
    .map((d) => `${d.line + 1}:${d.severity}:${d.message.split(' — ')[0]}`);
  // BRA at $9E reaches $20 (-128); at $A0 it does not (-130). Labels are not wrapped at $FF.
  assert.deepStrictEqual(msgs('\tORG\t$20\nBack\tNOP\n\tRMB\t125\n\tBRA\tBack\n\tBRA\tBack\n\tBSR\tFar\n\tRMB\t128\nFar\tRTS\n'), [
    '5:error:Branch target 32 ($20) is 130 bytes back',
    '6:error:Branch target 292 ($124) is 128 bytes ahead',
    '7:warning:From here on, code or data lies beyond $FF ($100…)',
  ]);
  assert.match(analyze('\tORG\t$20\nB\tBSR\tF\n\tRMB\t200\nF\tRTS\n').diagnostics[0].message, /use JSR$/);
  // values with labels: FCB Start+300, LDA of a label beyond $FF
  assert.deepStrictEqual(msgs('\tORG\t$20\nStart\tFCB\tStart+300\n\tORG\t$FF\nT\tNOP\nU\tNOP\n\tLDA\tU\n'), [
    '2:error:Value 332 ($14C) does not fit in a byte (−256…255)',
    '5:warning:From here on, code or data lies beyond $FF ($100…)',
    '6:error:Address 256 ($100) does not fit in a byte (−256…255)',
  ]);
  assert.deepStrictEqual(msgs('\tORG\t$20\nA$b\tNOP\nx.y\tNOP\n\tFCS\t""\n\tFCS\t"abc\n\tRMB\t0\n'), [
    '4:error:Bad operand syntax: empty string',
    '5:error:Bad operand syntax: the string has no closing \'"\' (qaflisp adds a newline byte)',
    '6:error:Undetermined size for reservation of storage',
  ]);
  const { layout } = analyze('\tORG\t$20\nL1\tNOP\nL1\tNOP\nL2\tNOP\n');
  assert.strictEqual(layout.stoppedAt, 1, 'a multiple definition stops the layout (qaflisp: phase error)');
  assert.strictEqual(layout.labels.get('L2'), undefined);
});

// --- Comparison with the real qaflisp ----------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-layout-'));
  // Addresses: compare the computed layout with qaflisp's listing, line by line.
  const LAYOUT_PROBE = '\tORG\t$20\nL1\tFCS\t"AB"\nL2\tFCS\t"A\\"B"\nL4\tFCS\t"a\\nb"\nL5\tFCB\t1,2,3\nL7\tRMB\t3\nL8\tLDA\tFoo\n' +
    'L9\tSTA\t#5\nL10\tLDAA\t#1\nL11\tTFR\tA,X\nL12\tLDA\t#300\nL13\tLDA\t,Z+\nL14\tFCB\t1,(2\nL16\tCLR\t,X+\nL17\tLDA\t2*(3,X\n' +
    'L18\tBRA\tL1\nL19\tMOVE\t#1,2\nL20\tFCB\tL19\nL21\tEQU\t5\nL22\tLSL\nL23\tLDA\t#1+\nL26\tFCB\t1,2 ,3\nL27\tFCB\t1,2, 3\n' +
    "L28\tLDA\t#'A\nL29\tJMP\t#5\nL30\tLDA\tX+1\nL32\tFCB\t,1\nL33\tLDA\t#(1,2)\nL34\tFCS\t\"x\",3\nL39\tLDA\t5/0\nL40\tFCB\t1,5/0,3\n" +
    'M1\tFCB\t2,#3\nM2\tFCB\t0a\nM3\tFCB\t1,0a,2\nM4\tLDA\t0a\nM5\tLDA\t2+#1\nM6\tFCB\t1,X\nM9\tLDA\t#$FG\nM14\tFCB\t1,1~2,3\n' +
    'M15\tFCB\t1,(2+),3\nM16\tLDA\t#()\nM17\tLDA\t#1~2\nM18\tFCB\t%0102,1\nM19\tANDCC\t$20\nN1\tLDA\t1=2\nN2\tLDA\t#1.5\nN3\tLDA\t1<2\n' +
    'N4\tFCB\t1=2,3\nN5\tFCB\t4,1.5,6\nA$b\tNOP\nx.y\tNOP\nN6\tFCS\t""\n\tORG\t$F0\nW1\tNOP\nW2\tRMB\t$20\nW3\tNOP\n\tBRA\tW1\n';
  test('addresses: computed layout equals the qaflisp listing', async () => {
    const sources = { layout: LAYOUT_PROBE, ...PROBES };
    for (const name of ['running-light.sflisp', 'sample.sflisp', 'screenshot-errors.sflisp']) sources[name] = fs.readFileSync(path.join(__dirname, name), 'utf8');
    let compared = 0;
    for (const [name, source] of Object.entries(sources)) {
      const file = path.join(tmp, `layout-${name.replace(/\.sflisp$/, '')}.sflisp`);
      fs.writeFileSync(file, source);
      await runQaflisp(realExe, file, { listFile: true });
      const listing = new Map();
      for (const l of fs.readFileSync(file.replace(/\.sflisp$/, '.lst'), 'latin1').split(/\r?\n/)) {
        const m = /^([0-9A-F]{2})((?: [0-9A-F]{2})*)\s+(\d+)\.(.*)$/.exec(l);
        if (m) listing.set(+m[3] - 1, { address: parseInt(m[1], 16), bytes: m[2].trim() ? m[2].trim().split(' ').length : 0, text: m[4] });
      }
      for (const [line, ours] of analyze(source).layout.lines) {
        const theirs = listing.get(line);
        if (!theirs || /^\s*\S*\s+(EQU|ORG|END)\b/i.test(theirs.text)) continue; // no code; listing shows the value
        const sizeOk = /\bRMB\b/i.test(theirs.text) || theirs.bytes === Math.min(ours.size, 6); // listing: at most 6 bytes, RMB one
        assert.ok((ours.address & 0xFF) === theirs.address && sizeOk,
          `${name} line ${line + 1}: ours $${(ours.address & 0xFF).toString(16)}/${ours.size}, qaflisp $${theirs.address.toString(16)}/${theirs.bytes}: ${theirs.text.trim()}`);
        compared++;
      }
    }
    assert.ok(compared > 150, `only ${compared} lines compared`);
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
