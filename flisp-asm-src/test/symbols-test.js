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

test("'#' only at the start of an instruction's operand, never in directives (except END)", () => {
  const a = analyze("P\tEQU\t#$FB\n\tORG\t#$00\n\tFCB\t2,#3\n\tFCS\t#\"AB\"\n\tFCS\t\"a#b\",#0\nS\tLDA\t2+#1\n\tLDA\t#1+#2\n\tLDA\t#'#'\n\tFCB\t'#',2\n\tEND\t#S\n");
  assert.deepStrictEqual(errors(a).map((d) => [d.line, d.start, d.end - d.start, d.message]), [
    [0, 6, 1, "Illegal character '#' — directives take plain values without '#': write EQU $FB"],
    [1, 5, 1, "Illegal character '#' — directives take plain values without '#': write ORG $00"],
    [2, 7, 1, "Illegal character '#' — directives take plain values without '#': write FCB 2,3"],
    [3, 5, 1, 'Bad operand syntax — FCS takes a string without \'#\', e.g. FCS "TEXT"'],
    [5, 8, 1, "Illegal character '#' — '#' marks immediate data and may only stand at the start of the operand, e.g. LDA #5"],
    [6, 8, 1, "Illegal character '#' — '#' marks immediate data and may only stand at the start of the operand, e.g. LDA #5"],
  ]);
});

test('FCB list with a blank: error after a trailing comma, warning if bytes follow', () => {
  const a = analyze("\tFCB\t1,2, 3,4\n\tFCB\t1,2 ,3\n\tFCB\t1,2 3,4\n\tFCB\t1,2,\n\tFCB\t1,2 %0101,'A'\n" +
    '\tFCB\t1,2 first two\n\tFCB\t1,2 Start,3\nStart\tFCB\t1,2 4 bytes\n\tFCB\t1,2 ; ok\n\tFCB\t1,2 3 cycles, then more\n');
  assert.deepStrictEqual(a.diagnostics.map((d) => [d.line, d.severity, d.start, d.end, d.message]), [
    [0, 'error', 8, 9, "Unterminated expression: the list ends with ',' — the blank ends the operand; remove it: FCB 1,2,3,4"],
    [1, 'warning', 9, 11, 'Blank in the FCB list — the rest of the line is a comment, so 3 is not assembled; remove the blank: FCB 1,2,3'],
    [2, 'warning', 9, 12, 'Blank in the FCB list — the rest of the line is a comment, so 3,4 is not assembled; remove the blank: FCB 1,2,3,4'],
    [3, 'error', 8, 9, "Unterminated expression: the list ends with ',' — remove the last ',' or add a value"],
    [4, 'warning', 9, 18, "Blank in the FCB list — the rest of the line is a comment, so %0101,'A' is not assembled; remove the blank: FCB 1,2,%0101,'A'"],
  ]);
});

test('numbers whose digits do not fit their base', () => {
  const a = analyze("\tORG\t0a\n\tFCB\t%000200100\n\tFCB\t$FG,1F\n\tLDA\t#%\n\tLDA\t$1g+1\n\tFCB\t$0a,077,%01,'0',L1\nL1\tFCS\t\"0x\"\n");
  assert.deepStrictEqual(a.diagnostics.map((d) => [d.line, d.start, d.end, d.message]), [
    [0, 5, 7, "Illegal decimal digit in '0a' — decimal numbers use only 0–9; for hex write $0A"],
    [1, 5, 15, "Illegal binary digit in '%000200100' — binary numbers use only 0 and 1"],
    [2, 5, 8, "Illegal hexadecimal digit in '$FG' — hexadecimal numbers use only 0–9 and A–F"],
    [2, 9, 11, "Illegal decimal digit in '1F' — decimal numbers use only 0–9; for hex write $1F"],
    [3, 6, 7, "Illegal binary digit: '%' without digits — write e.g. %0101"],
    [4, 5, 8, "Illegal hexadecimal digit in '$1g' — hexadecimal numbers use only 0–9 and A–F"],
  ]);
});

test('values that do not fit in a byte; ORG outside the memory; negative RMB', () => {
  const a = analyze('BIG\tEQU\t70000\nK\tEQU\tBIG/1000\n\tORG\t$100\n\tORG\t$20\nL\tFCB\t255,256,-256,-257,200+100,(1)\n' +
    '\tFCB\tBIG,K,L+300\n\tLDA\t#256\n\tLDA\t$100\n\tLDA\t300,X\n\tLDA\t#%11%%10\n\tRMB\t-1\n\tLDA\t#K*4\n');
  assert.deepStrictEqual(a.diagnostics.map((d) => [d.line, d.severity, d.start, d.end, d.message.split(' — ')[0]]), [
    [2, 'warning', 5, 9, 'ORG 256 ($100) is outside the memory ($00–$FF)'],
    [4, 'error', 10, 13, 'Value 256 ($100) does not fit in a byte (−256…255)'],
    [4, 'error', 19, 23, 'Value -257 does not fit in a byte (−256…255)'],
    [4, 'error', 24, 31, 'Value 300 ($12C) does not fit in a byte (−256…255)'],
    [5, 'error', 5, 8, 'Value 70000 ($11170) does not fit in a byte (−256…255)'],
    [6, 'error', 6, 9, 'Value 256 ($100) does not fit in a byte (−256…255)'],
    [7, 'error', 5, 9, 'Address 256 ($100) does not fit in a byte (−256…255)'],
    [8, 'error', 5, 8, 'Offset 300 ($12C) does not fit in a byte (−256…255)'],
    [10, 'error', 5, 7, 'Undetermined size for reservation of storage'],
    [11, 'error', 6, 9, 'Value 280 ($118) does not fit in a byte (−256…255)'],
  ]);
  assert.match(a.diagnostics[1].message, /writes only \$00$/);
});

test('expression syntax: parentheses, operators, reserved words, division by zero', () => {
  const lines = ['2*(3', '2*3)', '2+', '2**3', '2(3)', '1<2', '1=2', ',1', 'X+1', 'K/Z', "'A''B'", '()', '1~2', '7&&3||0', 'PC'];
  const a = analyze(`K\tEQU\t2\nZ\tEQU\t0\n${lines.map((l) => `\tFCB\t${l}\n`).join('')}`);
  const got = a.diagnostics.map((d) => [d.line - 2, d.severity, d.start - 5, d.end - 5, d.message.split(/ — |: /)[0]]);
  assert.deepStrictEqual(got, [
    [0, 'error', 3, 4, 'Missing Parenthesis'],
    [1, 'error', 3, 4, 'Unexpected Parenthesis'],
    [2, 'error', 1, 2, 'Unterminated expression'],
    [3, 'error', 2, 3, 'Operand expected'],
    [4, 'error', 1, 2, "Missing operator before '('"],
    [5, 'error', 1, 2, "Unexpected character '<'"],
    [6, 'error', 1, 2, "Unexpected character '=' in the expression"],
    [7, 'error', 0, 1, 'Unterminated expression'],
    [8, 'error', 0, 1, "Illegal use of reserved word 'X'"],
    [9, 'error', 1, 2, 'Integer divide by zero'],
    [10, 'error', 3, 6, "Missing operator before 'B'"],
    [11, 'warning', 1, 2, "Missing value before ')'"],
    [12, 'warning', 1, 2, "Missing operator before '~'"],
    [14, 'error', 0, 2, "Undefined symbol 'PC'"],
  ]);
});

test("'%' after an operand is modulo, not a binary number", () => {
  const a = analyze('K\tEQU\t3\n\tFCB\t7%3,7%K,(7)%2,%11%%10\n');
  assert.deepStrictEqual(a.diagnostics, []);
  assert.deepStrictEqual(a.references.map((r) => r.name), ['K']);
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
  immediate: "P\tEQU\t#$FB\nQ\tEQU\t$FB\n\tORG\t#$20\n\tFCB\t2,#3\n\tFCB\t-#1\n\tRMB\t#2\n\tFCS\t#\"AB\"\n\tFCS\t\"a#b\",#0\n" +
    "S\tLDA\t2+#1\n\tLDA\t##1\n\tLDA\t#1+#2\n\tLDA\t#'#'\n\tFCB\t'#',2\n\tLDA\t#Q\n\tEND\t#S\n",
  fcbList: '\tORG\t$20\n\tFCB\t1,2, 3,4\n\tFCB\t1,2 ,3\n\tFCB\t1,2 3,4\n\tFCB\t1,2,\n\tFCB\t1, $FF\n\tFCB\t1,2 first two\n\tFCB\t1,2 ; ok\n',
  numbers: '\tORG\t$20\n\tFCB\t0a\n\tFCB\t%000200100\n\tFCB\t$FG\n\tFCB\t12AB\n\tFCB\t%\n\tFCB\t$\n\tFCB\t0x1F\n\tFCB\t1F\n' +
    "\tFCB\t%0102,3\n\tFCB\t$1g+1\n\tLDA\t#%12\n\tLDA\t#09\n\tFCB\t$0a\n\tFCB\t%1_0\n\tFCB\t1_0\n\tFCB\t077\n\tFCB\t%0b\n\tFCB\t'0',$fF\n",
  values: 'BIG\tEQU\t70000\nK\tEQU\tBIG/1000\n\tORG\t$20\n\tFCB\t255\n\tFCB\t256\n\tFCB\t$1FF\n\tFCB\t-256\n\tFCB\t-257\n\tFCB\t200+100\n' +
    '\tFCB\t1,(2*200)\n\tFCB\tBIG\n\tFCB\tK\n\tLDA\t#256\n\tLDA\t#K*4\n\tLDA\t$100\n\tLDA\t300,X\n\tLDA\t-257,X\n\tLDA\t200,X\n\tRMB\t-1\n\tFCB\t7%3\n' +
    '\tFCB\t$FF+1-1\n\tFCB\t2<<1+1\n',
  // Every line one case; qaflisp reports exactly the lines with an error (warnings: accepted by qaflisp).
  expressions: 'K\tEQU\t2\nZ\tEQU\t0\n\tORG\t$20\nStart\tNOP\n' + [
    '2*(3', '2*3)', '()', '2+', '2**3', '(2))', '2(3)', '2+*3', '~', '!', '1<2', '1<<', '1<<<2', '1>>>2', '1=2', '1&&2', '1||2',
    '(1,2)', '-(-1)', '1--1', '1+-1', '1-~1', '5/0', '5%0', ',1', '1,,2', '(((1)))', ')1(', '2*-3', '2*~3', '2-!0', '1+(2',
    '1+2)*3', '3()', 'X+1', 'A', '1+A', 'K+', 'K(2)', "'A'+", "'A''B'", "2'A'", '1.5', '1?2', '1@', '[1]', '{1}', '1:',
    '(2**3)', '(&2)', '(+5)', '(2,)', 'LDA', 'K%Z', 'K/Z', '1/(1-1)', "K'A'", "(1)'A'", 'Kx', 'sp', 'Pc+1', '<<1', '>>1', '1>2',
    '1!2', '1~2', '(1)2', '2(', '(2+)', '(~)', '!()', '((1)', '(1))', '&2', '|2', '^2', '(1)(2)', '1&|2', '6^^3', '1+(-)',
  ].map((e) => `\tFCB\t${e}\n`).join('') + [
    'LDA\t#(5)', 'LDA\t#(1+2', 'LDA\t#1+', 'LDA\t(5),X', 'LDA\t(2+3),X', 'LDA\t1+,X', 'LDA\t(1,X)', 'LDA\t2*(1+1),Y', 'LDA\t#-(1)',
    'LDA\t#~', 'LDA\t,X+1', 'JMP\t(Start)', 'JMP\tStart+', 'BRA\t(Start)', 'ORG\t(1+2', 'RMB\t2*', 'ORG\t$20',
  ].map((l) => `\t${l}\n`).join('') + 'Q\tEQU\t(1\n',
};
const SYMBOL_ERROR = /Undefined symbol|Multiple definition|previously defined|Illegal mnemonic|Illegal label|Illegal [Aa]ddressing [Mm]ode|Illegal register combination|Syntax Error|Illegal character|Bad operand syntax|Unterminated expression|Illegal (decimal|binary|hexadecimal) digit|is truncated|Undetermined size|Parenthesis|Operand expected|Missing operator|reserved word|divide by zero|Bad delimiter|unreacheable/;

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
      if (['immediate', 'fcbList', 'numbers', 'values', 'expressions'].includes(name)) assert.deepStrictEqual(ours.sort((x, y) => x - y), theirs.sort((x, y) => x - y), 'exactly the lines qaflisp reports');
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
