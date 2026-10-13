// Tests for src/symbols.js. Runs without VS Code.
// The comparison with the real qaflisp runs only if qaflisp is found (as in qaflisp-test.js).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, parseLine, symbolAt, checkNewName, explainPhaseError } = require('../src/symbols');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const names = (list) => list.map((s) => s.name);
const errors = (a) => a.diagnostics.filter((d) => d.severity === 'error');

test('parseLine splits label, mnemonic and operand like qaflisp', () => {
  assert.deepStrictEqual(parseLine('Start       LDA     #$05        ; comment').label, { name: 'Start', start: 0, end: 5 });
  assert.strictEqual(parseLine('Start       LDA     #$05').operand.text, '#$05');
  assert.strictEqual(parseLine('LOOP:       INCA').label.name, 'LOOP');
  assert.strictEqual(parseLine('            INCA    not an operand').operand, undefined);
  assert.strictEqual(parseLine('            LDA     #K + 1').operand.text, '#K');
  assert.strictEqual(parseLine('            FCS     "A B" rest').operand.text, '"A B"');
  assert.strictEqual(parseLine("            LDA     #' '").operand.text, "#' '");
  assert.deepStrictEqual(parseLine('; comment'), {});
  assert.deepStrictEqual(parseLine('LDA         #1'), { invalidLabel: { name: 'LDA', start: 0, end: 3, reason: 'mnemonic' } });
  assert.strictEqual(parseLine('*x  NOP').invalidLabel.reason, 'character');
  assert.strictEqual(parseLine(' Start  LDA #1').next, 'LDA');
  assert.strictEqual(parseLine('Only').label.name, 'Only');
});

test('running-light.sflisp: definitions, kinds and references', () => {
  const a = analyze(fs.readFileSync(path.join(__dirname, 'running-light.sflisp'), 'utf8'));
  assert.deepStrictEqual(names(a.definitions),
    ['LEDS', 'SWITCHES', 'END_MARK', 'Patterns', 'Title', 'Count', 'Start', 'Restart', 'Next', 'Delay', 'Wait']);
  const kind = (n) => a.definitions.find((d) => d.name === n).kind;
  assert.strictEqual(kind('LEDS'), 'constant');
  assert.strictEqual(kind('Patterns'), 'data');
  assert.strictEqual(kind('Count'), 'data');
  assert.strictEqual(kind('Start'), 'code');
  assert.strictEqual(a.references.filter((r) => r.name === 'Count').length, 2);
  assert.strictEqual(a.references.filter((r) => r.name === 'Start').length, 2); // FCB Start, END Start
  assert.ok(!names(a.references).includes('X'), 'register X is not a symbol');
  assert.deepStrictEqual(a.diagnostics, []);
});

test('numbers, strings, character constants and registers are not symbols', () => {
  const a = analyze("\tLDA\t#$FF\n\tLDA\t%0101\n\tFCS\t\"Foo Bar\"\n\tLDA\t#'A'\n\tLDA\tA,Y\n\tLDA\t2,x\n\tTFR\tA,CC\n");
  assert.deepStrictEqual(a.references, []);
});

test('symbols in expressions and indexed operands are found', () => {
  const a = analyze('Tab\tFCB\t1,2\nK\tEQU\t3\n\tLDA\tTab+1\n\tLDA\t#K-1\n\tLDA\tK,X\n');
  assert.deepStrictEqual(a.references.map((r) => `${r.name}@${r.line}:${r.start}`), ['Tab@2:5', 'K@3:6', 'K@4:5']);
  assert.deepStrictEqual(a.diagnostics, []);
});

test('undefined symbols, with a hint for a different case', () => {
  const a = analyze('Loop\tNOP\n\tBRA\tloop\n\tBRA\tNowhere\n');
  assert.deepStrictEqual(errors(a).map((d) => [d.line, d.message]), [
    [1, "Undefined symbol 'loop' — did you mean 'Loop'? Symbols are case-sensitive."],
    [2, "Undefined symbol 'Nowhere'"],
  ]);
});

test('multiple definitions are reported on every defining line', () => {
  const a = analyze('L\tNOP\nL\tNOP\nK\tEQU\t1\nK\tNOP\n');
  assert.deepStrictEqual(errors(a).map((d) => [d.line, d.message]), [
    [0, "Multiple definition of 'L' (also in line 2)"],
    [1, "Multiple definition of 'L' (also in line 1)"],
    [2, "Multiple definition of 'K' (also in line 4)"],
    [3, "Multiple definition of 'K' (also in line 3)"],
  ]);
});

test('nothing after END counts, like in qaflisp', () => {
  const a = analyze('\tBRA\tLate\n\tEND\nLate\tNOP\n');
  assert.deepStrictEqual(names(a.definitions), []);
  assert.deepStrictEqual(errors(a).map((d) => d.message), ["Undefined symbol 'Late'"]);
});

test('a register name as label gives a warning', () => {
  const a = analyze('X\tEQU\t3\n');
  assert.deepStrictEqual(a.diagnostics.map((d) => [d.severity, d.message]),
    [['warning', "'X' is a register name and cannot be used as a symbol"]]);
});

test('line structure: indented label, typo, mnemonic or bad character in column 1', () => {
  const a = analyze(' Start\tLDA\t#1\n  Alone\n\tLDAA\t#1\nLDA\t#1\n1abc\tNOP\n\tlda\t#1\n\tMOVE\t#1,2\n');
  assert.deepStrictEqual(errors(a).map((d) => [d.line, d.start, d.message]), [
    [0, 1, "Illegal mnemonic 'Start' — if 'Start' is a label, it must start in column 1"],
    [1, 2, "Illegal mnemonic 'Alone' — if 'Alone' is a label, it must start in column 1"],
    [2, 1, "Illegal mnemonic 'LDAA'"],
    [3, 0, "Illegal mnemonic: 'LDA' in column 1 is read as a label — indent instructions"],
    [4, 0, "Illegal label — a label must start with a letter or '_'"],
  ]);
});

test('explainPhaseError points to the multiple definition above', () => {
  const a = analyze('\tORG\t$20\nStart\tLDA\t#1\nNext\tNOP\nStart\n\tBRA\tNext\n');
  const e = explainPhaseError(a, 2);
  assert.strictEqual(e.relatedLine, 1);
  assert.match(e.message, /'Start' is defined more than once \(line 2\)/);
  assert.strictEqual(explainPhaseError(analyze('K\tEQU\tM\nM\tEQU\t2\n'), 1).relatedLine, undefined);
});

test('symbolAt finds definitions and references', () => {
  const a = analyze('Loop\tNOP\n\tBRA\tLoop\n');
  assert.deepStrictEqual(symbolAt(a, 0, 2), { name: 'Loop', start: 0, end: 4, isDefinition: true });
  assert.deepStrictEqual(symbolAt(a, 1, 6), { name: 'Loop', start: 5, end: 9, isDefinition: false });
  assert.strictEqual(symbolAt(a, 1, 1), undefined);
});

test('checkNewName rejects invalid names, registers, mnemonics and clashes', () => {
  const a = analyze('Loop\tNOP\nEnd2\tNOP\n');
  assert.strictEqual(checkNewName(a, 'Loop', 'Again'), undefined);
  assert.match(checkNewName(a, 'Loop', '1st'), /not a valid symbol name/);
  assert.match(checkNewName(a, 'Loop', 'sp'), /register/);
  assert.match(checkNewName(a, 'Loop', 'lda'), /mnemonic/);
  assert.match(checkNewName(a, 'Loop', 'End2'), /already defined/);
});

// --- Comparison with the real qaflisp ----------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

const PROBES = {
  clean: 'K\tEQU\t3\n\tORG\t$20\nStart\tLDA\t#K\n\tLDX\t#Tab\n\tBRA\tStart\nTab\tFCB\t1,2\n\tEND\tStart\n',
  undefined: '\tORG\t$20\nLoop\tNOP\n\tBRA\tloop\n\tLDA\tFoo+Bar\n\tLDA\tOff,X\n\tFCB\tA1,2\n',
  multiple: '\tORG\t$20\nL\tNOP\nL\tNOP\nK\tEQU\t1\nK\tEQU\t2\nM\tNOP\nM\tEQU\t2\n',
  afterEnd: '\tORG\t$20\n\tBRA\tLate\n\tEND\nLate\tNOP\n',
  structure: '\tORG\t$20\n Start\tLDA\t#1\n  Alone\n\tLDAA\t#1\nLDA\t#1\n1abc\tNOP\n\tlda\t#1\n',
  operands: '\tORG\t$20\n\tSTA\t#5\n\tCLR\t,X+\n\tTFR\tA,X\n\tLDA\n\tANDCC\t$20\n\tJMP\t#5\n\tBEQ\t3,X\n\tLEAX\t3,Y\n' +
    '\tEXG\tA,X\n\tLDA\t#5,X\n\tLSL\n\tCMPSP\t3,X\n\tLDA\t,Z+\n\tSTA\t3,PC\n\tLDA\tA,SP\n\tLDA\t,X\n\tEXG\tY,X\n\tLDA\t-3,y\n',
};
const SYMBOL_ERROR = /Undefined symbol|Multiple definition|previously defined|Illegal mnemonic|Illegal label|Illegal [Aa]ddressing [Mm]ode|Illegal register combination|Syntax Error/;

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-symbols-'));
  for (const [name, source] of Object.entries(PROBES)) {
    test(`same symbol errors as qaflisp: ${name}`, async () => {
      const file = path.join(tmp, `${name}.sflisp`);
      fs.writeFileSync(file, source);
      const r = await runQaflisp(realExe, file, { warnings: true });
      const theirs = [...new Set(r.messages.filter((m) => SYMBOL_ERROR.test(m.message)).map((m) => m.line - 1))];
      const ours = [...new Set(errors(analyze(source)).map((d) => d.line))];
      for (const line of theirs) assert.ok(ours.includes(line), `qaflisp reports line ${line + 1}, we do not (${r.output})`);
      if (theirs.length === 0) assert.deepStrictEqual(ours, [], 'qaflisp finds no symbol errors, we do');
    });
  }
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
