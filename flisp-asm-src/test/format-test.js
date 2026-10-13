// Tests for src/format.js. Runs without VS Code.
// The key property: formatting changes only blanks, never the meaning. Checked with the
// symbol analysis and - if qaflisp is found - by comparing the generated machine code.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeColumns, visualColumn, nextStop, previousStop, formatLine, formatText } = require('../src/format');
const { analyze } = require('../src/symbols');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const C = [12, 20, 36];

test('tab stops: next and previous column', () => {
  assert.deepStrictEqual([0, 5, 12, 13, 20, 35].map((c) => nextStop(c, C, 4)), [12, 12, 20, 20, 36, 36]);
  assert.deepStrictEqual([36, 37, 40, 41].map((c) => nextStop(c, C, 4)), [40, 40, 44, 44]);
  assert.deepStrictEqual([0, 3, 12, 15, 20, 36, 40, 42].map((c) => previousStop(c, C, 4)), [0, 0, 0, 12, 12, 20, 36, 40]);
});

test('visual column counts tabs', () => {
  assert.strictEqual(visualColumn('\tLDA', 1, 8), 8);
  assert.strictEqual(visualColumn('ab\tLDA', 3, 4), 4);
  assert.strictEqual(visualColumn('abc', 3, 4), 3);
});

test('normalizeColumns accepts three increasing numbers, else the default', () => {
  assert.deepStrictEqual(normalizeColumns([8, 16, 32]), [8, 16, 32]);
  assert.deepStrictEqual(normalizeColumns([20, 12, 36]), C);
  assert.deepStrictEqual(normalizeColumns([12, 20]), C);
  assert.deepStrictEqual(normalizeColumns(undefined), C);
});

test('formatLine aligns label, mnemonic, operand and comment', () => {
  const f = (l) => formatLine(l, C);
  assert.strictEqual(f('Start LDA #$05 ; comment'), 'Start       LDA     #$05            ; comment');
  assert.strictEqual(f('\tORG\t$20'), '            ORG     $20');
  assert.strictEqual(f('L2:\tDECA wait here'), 'L2:         DECA                    wait here');
  assert.strictEqual(f('Title FCS "A B" rest'), 'Title       FCS     "A B"           rest');
  assert.strictEqual(f('state_vector_long FCB 1'), 'state_vector_long FCB 1', 'long label: one blank');
  assert.strictEqual(f('Only'), 'Only');
  assert.strictEqual(f('Only ; c'), 'Only        ; c');
  assert.strictEqual(f("\tLDA\t#' '"), "            LDA     #' '");
  assert.strictEqual(f('   '), '');
});

test('formatLine leaves comment lines and irregular lines unchanged', () => {
  for (const l of ['; header', '   ; indented comment', ' Start LDA #1', 'LDA #1', '\tLDAA #1', '*x NOP']) {
    assert.strictEqual(formatLine(l, C), l.replace(/[ \t]+$/, ''), l);
  }
});

const same = (a, b) => {
  const pick = (x) => ({
    defs: x.definitions.map((d) => `${d.name}@${d.line}:${d.kind}`),
    refs: x.references.map((r) => `${r.name}@${r.line}`),
    diags: x.diagnostics.map((d) => `${d.line}:${d.message}`),
  });
  assert.deepStrictEqual(pick(b), pick(a));
};

for (const name of ['sample.sflisp', 'running-light.sflisp']) {
  test(`formatting ${name} keeps all symbols, uses and messages`, () => {
    const src = fs.readFileSync(path.join(__dirname, name), 'utf8');
    const out = formatText(src, C);
    same(analyze(src), analyze(out));
    assert.strictEqual(formatText(out, C), out, 'formatting twice changes nothing');
  });
}

// --- Same machine code with the real qaflisp --------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-format-'));
  test('real qaflisp: formatted files assemble to the same machine code', async () => {
    const sources = {
      'running-light': fs.readFileSync(path.join(__dirname, 'running-light.sflisp'), 'utf8'),
      // sample.sflisp without the lines qaflisp rejects (lab instructions, LDA in column 1)
      sample: fs.readFileSync(path.join(__dirname, 'sample.sflisp'), 'utf8').split(/\r?\n/)
        .filter((l) => !/MOVE|CMJEQ|^LDA/.test(l)).join('\n'),
      edge: "\tORG\t$20\nK EQU 3 the constant\nStart LDA #K+1 load\n\tPSHA save A\nT FCS \"A B\" text\n\tFCB 'x',K\n\tEND Start start\n",
    };
    for (const [name, src] of Object.entries(sources)) {
      const s19 = async (tag, text) => {
        const file = path.join(tmp, `${name}-${tag}.sflisp`);
        fs.writeFileSync(file, text);
        const r = await runQaflisp(realExe, file, { warnings: true });
        assert.deepStrictEqual(r.messages, [], `${name} (${tag}): ${r.output}`);
        return fs.readFileSync(file.replace(/\.sflisp$/, '.s19'), 'utf8');
      };
      assert.strictEqual(await s19('formatted', formatText(src, C)), await s19('original', src), name);
    }
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
