// Tests for src/symbols.js. Runs without VS Code.
// The comparison with the real qaflisp runs only if qaflisp is found (as in qaflisp-test.js).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, parseLine, symbolAt, checkNewName } = require('../src/symbols');
const { explainPhaseError } = require('../src/checks');
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
    [5, 'error', 11, 16, 'Value 332 ($14C) does not fit in a byte (−256…255)'], // L+300 with L = $20
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

// ORG and RMB in qaflisp's first pass (measured): [live check reports an error, source]
const PASS1 = {
  rmbLaterLabel: [true, "\tORG\t$20\nStart\tNOP\n\tRMB\tLater-Start\n\tNOP\nLater\tNOP\n"],
  orgLaterLabel: [true, "\tORG\t$20\nStart\tNOP\n\tORG\tLater\n\tNOP\nLater\tNOP\n"],
  rmbLaterConst: [false, "\tORG\t$20\n\tRMB\tK\nL1\tNOP\nK\tEQU\t4\n"],
  orgLaterConst: [true, "\tORG\tK\nL1\tNOP\nK\tEQU\t$30\n"],
  rmbSelf: [true, "\tORG\t$20\nL0\tRMB\tL1-L0\nL1\tNOP\n"],
  orgViaEquLaterLabel: [true, "K\tEQU\tLater\n\tORG\tK\nLater\tNOP\n"],
  rmbViaEquLaterLabel: [true, "\tORG\t$20\nK\tEQU\tLater-Start\nStart\tRMB\tK\n\tNOP\nLater\tNOP\n"],
  rmbLabelsAbove: [false, "\tORG\t$20\nStart\tNOP\n\tRMB\tStart+2-Start\nLater\tNOP\n"],
  orgLabelAbove: [false, "\tORG\t$20\nStart\tNOP\n\tORG\tStart+4\nL2\tNOP\n"],
  rmbOwnLabel: [false, "\tORG\t$20\nStart\tRMB\tStart-$1E\n\tNOP\n"],
  rmbLaterEquOfLaterLabels: [true, "\tORG\t$20\n\tRMB\tK\nK\tEQU\tL2-L1\nL1\tNOP\nL2\tNOP\n"],
  chainForward: [true, "K\tEQU\tM\nM\tEQU\t2\n\tORG\t$20\n\tRMB\tK\nL1\tNOP\n"],
  equLabelLaterThanEqu: [true, "K\tEQU\tStart\n\tORG\t$20\nStart\tNOP\n\tRMB\tK-$1F\nL1\tNOP\n"],
  chainInOrder: [false, "M\tEQU\t2\nK\tEQU\tM\n\tORG\t$20\n\tRMB\tK\nL1\tNOP\n"],
  equAfterLabel: [true, "\tORG\t$20\nStart\tNOP\nK\tEQU\tStart+1\n\tRMB\tK-$20\nL1\tNOP\n"],
  rmbLaterChain: [true, "\tORG\t$20\n\tRMB\tK\nK\tEQU\tM\nM\tEQU\t2\nL1\tNOP\n"],
  orgViaEquLabelAbove: [true, "\tORG\t$20\nStart\tNOP\nK\tEQU\tStart+4\n\tORG\tK\nL1\tNOP\n"],
  rmbViaEquSelfDiff: [true, "\tORG\t$20\nStart\tNOP\nK\tEQU\tStart-Start+2\n\tRMB\tK\nL1\tNOP\n"],
  rmbTwoEqus: [true, "\tORG\t$20\nStart\tNOP\nK\tEQU\tStart\nJ\tEQU\tK-$1F\n\tRMB\tJ\nL1\tNOP\n"],
  fcbViaEqu: [false, "\tORG\t$20\nStart\tNOP\nK\tEQU\tStart+4\n\tFCB\tK\n\tLDA\t#K\nL1\tNOP\n"],
  orgChainForward: [true, "K\tEQU\tM\nM\tEQU\t$30\n\tORG\tK\nL1\tNOP\n"],
  rmbNetZero: [true, "\tORG\t$20\nStart\tNOP\nEnd1\tNOP\nK\tEQU\tEnd1-Start+Start-Start\n\tRMB\tK\nL1\tNOP\n"],
  rmbLabelMul: [true, "\tORG\t$20\nStart\tNOP\nK\tEQU\t(Start-$20)*2\n\tRMB\tK\nL1\tNOP\n"],
  rmbDirectLabelDiff: [false, "\tORG\t$20\nStart\tNOP\nEnd1\tNOP\n\tRMB\tEnd1-Start\nL1\tNOP\n"],
};
// Accepted differences: qaflisp gives no message here, but the code only works by chance
// (circular ORG, resolved to 0) or is contrived (Start-Start+2).
const PASS1_DIFFERENT = new Set(['orgViaEquLaterLabel', 'rmbViaEquSelfDiff']);

test('ORG and RMB: values qaflisp does not know in its first pass', () => {
  for (const [name, [flag, src]] of Object.entries(PASS1)) {
    const errs = analyze(src).diagnostics.filter((d) => d.severity === 'error');
    assert.strictEqual(errs.length > 0, flag, `${name}: ${errs.map((d) => d.message).join('; ') || 'no error'}`);
  }
  const msgs = (src) => analyze(src).diagnostics.map((d) => `${d.line + 1}:${d.message.split(' — ')[0]}`);
  assert.deepStrictEqual(msgs(PASS1.orgLaterConst[1]), ["1:Forward reference: 'K' is defined further down (line 3)"]);
  assert.deepStrictEqual(msgs(PASS1.rmbLaterLabel[1]), ["3:RMB depends on label 'Later', which is defined further down (line 5)"]);
  assert.deepStrictEqual(msgs(PASS1.equAfterLabel[1]), ["4:RMB uses 'K', which depends on the label 'Start'"]);
  assert.deepStrictEqual(msgs(PASS1.chainForward[1]), ["4:RMB uses 'K', but 'K' uses 'M', which is defined further down (line 2)"]);
  assert.deepStrictEqual(msgs('\tORG\t$20\n\tBRA\t*+2\n'), ["2:Operand expected: there is no location counter '*'"]);
  const e = explainPhaseError(analyze(PASS1.rmbLaterLabel[1]), 4);
  assert.strictEqual(e.relatedLine, 2);
  assert.match(e.message, /the RMB in line 3 uses a value that qaflisp does not know in pass 1/);
  assert.match(explainPhaseError(analyze(PASS1.orgViaEquLabelAbove[1]), 4).message, /the ORG in line 4 .* sets a different address/);
});

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

test("'%' after an operand is modulo, not a binary number", () => {
  const a = analyze('K\tEQU\t3\n\tFCB\t7%3,7%K,(7)%2,%11%%10\n');
  assert.deepStrictEqual(a.diagnostics, []);
  assert.deepStrictEqual(a.references.map((r) => r.name), ['K']);
});

test('FCB (1,2): the message explains that the comma splits the list', () => {
  const msg = (op) => analyze(`\tFCB\t${op}\n`).diagnostics.map((d) => d.message);
  assert.deepStrictEqual(msg('(1,2)'), ["Missing Parenthesis: in FCB every comma separates two values, also inside parentheses — '(1' is not closed; for a list of bytes write FCB 1,2"]);
  assert.match(msg('3,(1,2),4')[0], /every comma separates two values.*'\(1' is not closed$/);
  assert.deepStrictEqual(msg('(1+2'), ["Missing Parenthesis: '(' is not closed"], 'no comma: the short message');
});

test('an operand after an instruction without operand gets a warning; plain words do not', () => {
  const src = '\tORG\t$20\nData\tFCB\t1\n\tPSHA\t$3\t; c\n\tNOP\t#5\n\tASLA\tData\n\tINCA\t2,X\n\tCLRA\t,X\n\tLSRA\tData+1\n' +
    '\tRTS\tzurueck zum Aufrufer\n\tNOP\tDatenbyte\n\tRTI\t; ok\n\tNOP\n';
  assert.deepStrictEqual(analyze(src).diagnostics.map((d) => `${d.line + 1}:${d.severity}:${d.message}`), [
    "3:warning:PSHA has no operand — qaflisp silently treats '$3' as a comment; remove it, or put a comment after ';'",
    "4:warning:NOP has no operand — qaflisp silently treats '#5' as a comment; remove it, or put a comment after ';'",
    "5:warning:ASLA has no operand — qaflisp silently treats 'Data' as a comment; to work on memory write ASL Data",
    "6:warning:INCA has no operand — qaflisp silently treats '2,X' as a comment; to work on memory write INC 2,X",
    "7:warning:CLRA has no operand — qaflisp silently treats ',X' as a comment; remove it, or put a comment after ';'",
    "8:warning:LSRA has no operand — qaflisp silently treats 'Data+1' as a comment; to work on memory write LSR Data+1",
  ]);
});

test('a mnemonic name in column 1 is a label; alone it generates no code', () => {
  const a = analyze('Neg\tEQU\t3\n\tORG\t$20\nEnd\tNOP\nInc\tINCA\n\tLDA\t#Neg\n\tBRA\tEnd\nNOP\nRTS\t; c\nLDA\t#1\n');
  assert.deepStrictEqual(a.diagnostics.map((d) => `${d.line + 1}:${d.severity}:${d.message.split(' — ')[0]}`), [
    "7:warning:'NOP' in column 1 is read as a label, so this line generates no code",
    "8:warning:'RTS' in column 1 is read as a label, so this line generates no code",
    "9:error:Illegal mnemonic: 'LDA' in column 1 is read as a label",
  ]);
  assert.strictEqual(a.valueOf('End'), 0x20);
  assert.strictEqual(a.valueOf('Neg'), 3);
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
  // ("Phase error" of an RMB is reported by qaflisp at the later label, so it is tested above only.)
  forward: '\tORG\t$20\nL0\tRMB\tL1-L0\nL1\tNOP\n\tRMB\tK\nK\tEQU\t2\n\tORG\tK2\nK2\tEQU\t$40\n\tORG\tL1+4\n\tRMB\tL1+2-L0\n\tBRA\t*+2\n',
  mnemonicLabels: 'Neg\tEQU\t3\n\tORG\t$20\nEnd\tNOP\nInc\tINCA\n\tLDA\t#Neg\n\tBRA\tEnd\nNOP\nRTS\t; c\nLDA\t#1\n',
  // branch distances and values with labels (needs the address layout)
  branches: 'L0\tNOP\n\tORG\t$20\nBack\tNOP\n\tRMB\t125\n\tBRA\tBack\n\tBRA\tBack\n\tBRA\tFwd\n\tRMB\t126\nFwd\tNOP\n\tBRA\tFwd2\n\tRMB\t127\n' +
    'Fwd2\tNOP\n\tORG\t$F0\n\tBRA\t$10\n\tBRA\t$F0\n\tBSR\t$C0\n\tBRA\tL0+$100\n\tFCB\tFwd2\n\tLDA\tBack+$E0\n\tLDA\t#Fwd\n\tFCS\t""\n\tRMB\t0\n',
};
const SYMBOL_ERROR = /Undefined symbol|Multiple definition|previously defined|Illegal mnemonic|Illegal label|Illegal [Aa]ddressing [Mm]ode|Illegal register combination|Syntax Error|Illegal character|Bad operand syntax|Unterminated expression|Illegal (decimal|binary|hexadecimal) digit|is truncated|Undetermined size|Parenthesis|Operand expected|Missing operator|reserved word|divide by zero|Bad delimiter|unreacheable|Forward reference|Displacement/;

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
      if (['immediate', 'fcbList', 'numbers', 'values', 'expressions', 'forward', 'branches', 'mnemonicLabels'].includes(name)) assert.deepStrictEqual(ours.sort((x, y) => x - y), theirs.sort((x, y) => x - y), 'exactly the lines qaflisp reports');
    });
  }
  test('ORG and RMB in pass 1: an error exactly where qaflisp reports one (some report it at a later line)', async () => {
    for (const [name, [flag, source]] of Object.entries(PASS1)) {
      const file = path.join(tmp, `pass1-${name}.sflisp`);
      fs.writeFileSync(file, source);
      const r = await runQaflisp(realExe, file, {});
      const theirs = r.messages.some((m) => m.severity === 'error');
      assert.strictEqual(theirs, PASS1_DIFFERENT.has(name) ? !flag : flag, `${name}: qaflisp ${theirs ? 'reports an error' : 'accepts it'} (${r.output})`);
    }
  });
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
