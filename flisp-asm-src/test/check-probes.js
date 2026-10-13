// Small sources for the comparison of the live check with the real qaflisp
// (checks-test.js: the same error lines; layout-test.js: the same addresses).

module.exports = {
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
