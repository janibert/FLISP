// Tests for the live checks (src/checks.js, src/expression.js). Runs without VS Code.
// The comparison with the real qaflisp runs only if qaflisp is found (as in qaflisp-test.js).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('../src/symbols');
const { explainPhaseError } = require('../src/checks');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');
const PROBES = require('./check-probes');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const errors = (a) => a.diagnostics.filter((d) => d.severity === 'error');

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

test('directives without operand or label; the layout goes on after them as in qaflisp', () => {
  const a = analyze('\tORG\n\tRMB\t; size?\nK\tEQU\n\tEQU\t5\n\tFCB\n\tFCS\n\tORG\t$20\n\tORG\t1+\n\tRMB\tNix\nL\tNOP\n');
  assert.deepStrictEqual(errors(a).map((d) => [d.line, d.kind]), [
    [0, 'missingOperand'], [1, 'missingOperand'], [2, 'missingOperand'], [3, 'equWithoutLabel'],
    [4, 'missingOperand'], [5, 'missingOperand'], [7, 'missingValue'], [8, 'undefinedSymbol'],
  ]);
  assert.strictEqual(a.layout.stoppedAt, undefined);
  assert.deepStrictEqual(a.layout.lines.get(9), { address: 0x20, size: 1 });
});

test('FCS: warnings for what qaflisp does silently ("" at the start, text after the string)', () => {
  const kinds = (src) => analyze(src).diagnostics.map((d) => [d.line, d.severity, d.kind]);
  assert.deepStrictEqual(kinds('\tFCS\t""x"\n\tFCS\t"a""b"\n\tFCS\t"a"Foo\n\tFCS\t"" ab"cd\n'), [
    [0, 'warning', 'fcsQuoteFirst'], [1, 'warning', 'fcsIgnoredRest'], [2, 'warning', 'fcsIgnoredRest'],
    [3, 'warning', 'fcsQuoteFirst'], [3, 'warning', 'fcsIgnoredRest'],
  ]);
  assert.deepStrictEqual(kinds('\tFCS\t"a\\"b"\n\tFCS\t"a b" ; c\n'), []);
});

test('non-ASCII: error outside comments, strings and character constants depend on the encoding', () => {
  const src = "\tORG\t$20\nÖver\tNOP\t; å is fine here\n\tBRA\tÖver\n\tFCS\t\"åb\"\n\tLDA\t#'å'\n\tNOP\n";
  const kinds = (encoding) => analyze(src, { encoding }).diagnostics.map((d) => [d.line, d.severity, d.kind]);
  assert.deepStrictEqual(kinds('utf8'), [[1, 'error', 'nonAscii'], [2, 'error', 'nonAscii'], [3, 'warning', 'nonAsciiString'], [4, 'error', 'nonAsciiChar']]);
  assert.deepStrictEqual(kinds('singleByte'), [[1, 'error', 'nonAscii'], [2, 'error', 'nonAscii'], [3, 'warning', 'nonAsciiString'], [4, 'warning', 'nonAsciiChar']]);
  // FCS "åb": 3 bytes in UTF-8, 2 in a single-byte code page; LDA #'å' is rejected in UTF-8 (0 bytes)
  const nop = (encoding) => analyze(src, { encoding }).layout.lines.get(5).address;
  assert.strictEqual(nop('utf8'), 0x20 + 3);
  assert.strictEqual(nop('singleByte'), 0x20 + 2 + 2);
});

test('lines are split like VS Code does: CRLF, LF and a lone CR', () => {
  assert.deepStrictEqual(analyze('\tLDA\tA1\r\n\tLDA\tA2\n\tLDA\tA3\r\tLDA\tA4').diagnostics.map((d) => d.line), [0, 1, 2, 3]);
});

test('an undefined start symbol after END is only a warning, as in qaflisp', () => {
  const a = analyze('Start\tNOP\n\tEND\tstart\n');
  assert.deepStrictEqual(a.diagnostics.map((d) => [d.line, d.severity, d.kind]), [[1, 'warning', 'undefinedStartSymbol']]);
  assert.match(a.diagnostics[0].message, /did you mean 'Start'/);
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

// --- Comparison with the real qaflisp ----------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

const SYMBOL_ERROR = /Undefined symbol|Multiple definition|previously defined|Illegal mnemonic|Illegal label|Illegal [Aa]ddressing [Mm]ode|Illegal register combination|Syntax Error|Illegal character|Bad operand syntax|Unterminated expression|Illegal (decimal|binary|hexadecimal) digit|is truncated|Undetermined size|Parenthesis|Operand expected|Missing operator|reserved word|divide by zero|Bad delimiter|unreacheable|Forward reference|Displacement/;

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-checks-'));
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
