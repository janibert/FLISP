// Tests for src/instructions.js and src/instructionHover.js. Runs without VS Code.
// If qaflisp is found, every variant is assembled and opcode and length are compared,
// and every addressing mode that is NOT listed must be rejected by qaflisp.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { INSTRUCTIONS, MODES, DIRECTIVES, LAB } = require('../src/instructions');
const mnemonics = require('../src/mnemonics');
const { hoverAt, modeOf, operationOf } = require('../src/instructionHover');
const { checkOperand } = require('../src/addressing');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('every entry is complete and consistent', () => {
  for (const [mn, d] of Object.entries(INSTRUCTIONS)) {
    assert.ok(['flow', 'other'].includes(d.group), `${mn}: group`);
    assert.ok(d.title && d.op, `${mn}: title/op`);
    assert.match(d.flags, /^[Δ01-]{4,5}$/, `${mn}: flags`);
    assert.ok(d.variants.length > 0, `${mn}: variants`);
    for (const v of d.variants) {
      assert.ok(MODES[v.mode], `${mn}: mode ${v.mode}`);
      assert.match(v.opcode, /^[0-9A-F]{2}$/, `${mn}: opcode`);
      assert.ok(v.bytes >= 1 && v.bytes <= 2 && v.cycles >= 2 && v.cycles <= 6, `${mn} ${v.mode}: bytes/cycles`);
    }
    if (d.alias) assert.deepStrictEqual(d.variants.map((v) => v.opcode), INSTRUCTIONS[d.alias].variants.map((v) => v.opcode), `${mn} = ${d.alias}`);
  }
});

test('mnemonic lists are derived from the instruction table (92 words)', () => {
  assert.strictEqual(mnemonics.ALL.length, 92);
  assert.strictEqual(new Set(mnemonics.ALL).size, 92);
  assert.deepStrictEqual(mnemonics.INHERENT_FLOW, ['RTS', 'RTI']);
  assert.deepStrictEqual(mnemonics.DIRECTIVES, Object.keys(DIRECTIVES));
  assert.deepStrictEqual(mnemonics.LAB, Object.keys(LAB));
  assert.ok(mnemonics.isInherent('nop') && mnemonics.takesOperand('LDA') && !mnemonics.takesOperand('RTS'));
});

test('modeOf recognises every addressing mode', () => {
  const cases = { '': 'inh', '#5': 'imm', '$20': 'abs', 'Tab+1': 'abs', '2,SP': 'nsp', 'n,X': 'nx', '-3,y': 'ny',
    'A,X': 'ax', 'a,y': 'ay', ',X+': 'xinc', ',X-': 'xdec', ',+X': 'incx', ',-X': 'decx',
    ',Y+': 'yinc', ',Y-': 'ydec', ',+Y': 'incy', ',-Y': 'decy',
    // a ',' inside a character constant is no index separator (qaflisp 1.3 accepts these)
    "#','": 'imm', "','": 'abs', "','+1": 'abs', "',',X": 'nx', "',',SP": 'nsp', "#',',X": 'bad' };
  for (const [op, mode] of Object.entries(cases)) assert.strictEqual(modeOf('LDA', op || undefined).mode, mode, op);
  assert.strictEqual(modeOf('BEQ', 'Loop').mode, 'rel');
  assert.deepStrictEqual(modeOf('TFR', 'a,cc'), { mode: 'reg', operand: 'A,CC' });
});

test('operationOf fills in operand, effective address and side effects', () => {
  const op = (mn, mode, operand) => operationOf(INSTRUCTIONS[mn], INSTRUCTIONS[mn].variants.find((v) => v.mode === mode && (!operand || v.operand === operand)));
  assert.strictEqual(op('LDA', 'imm'), 'Data → A');
  assert.strictEqual(op('LDA', 'xinc'), 'M(X) → A; X + 1 → X');
  assert.strictEqual(op('STA', 'decy'), 'Y − 1 → Y; A → M(Y)');
  assert.strictEqual(op('INC', 'nsp'), 'M(n+SP) + 1 → M(n+SP)');
  assert.strictEqual(op('LEAX', 'nsp'), 'n+SP → X');
  assert.strictEqual(op('JMP', 'ax'), 'A+X → PC');
  assert.strictEqual(op('TFR', 'reg', 'X,SP'), 'X → SP');
});

test('hoverAt: variant of the line, unsupported mode, directive, lab instruction', () => {
  const h = hoverAt('Next        LDA     ,X+   ; comment', 13);
  assert.match(h.markdown, /\*\*This line:\*\* `LDA ,X\+`/);
  assert.match(h.markdown, /opcode `F5` · 1 byte · 4 cycles/);
  assert.deepStrictEqual([h.start, h.end], [12, 15]);
  assert.match(hoverAt('\tSTA\t#5', 2).markdown, /STA has no immediate addressing/);
  assert.match(hoverAt('\tTFR\tA,X', 2).markdown, /Illegal register combination 'A,X'/);
  assert.match(hoverAt('\tORG\t$20', 2).markdown, /assembler directive/);
  assert.match(hoverAt('\tMOVE\t#1,2', 2).markdown, /Lab-specific/);
  assert.match(hoverAt('\tPSHCC', 2).markdown, /same as `PSHC`/);
  assert.strictEqual(hoverAt('\tLDA\t#5', 6), undefined, 'operand is not the mnemonic');
});

test('hoverAt: compact form for one addressing mode, legend only for used flag symbols', () => {
  const rts = hoverAt('\tRTS', 2).markdown;
  assert.ok(!/This line/.test(rts), 'no "This line" for a single variant');
  assert.match(rts, /`M\(SP\) → PC; SP \+ 1 → SP` · opcode `43` · 1 byte · 2 cycles/);
  assert.match(rts, /\*\*Flags\*\* \(– unchanged\)/);
  assert.match(hoverAt('\tBEQ\tLoop', 2).markdown, /· Relative `BEQ Adr`/);
  assert.match(hoverAt('\tANDCC\t$20', 2).markdown, /\*\*This line:\*\* Illegal addressing mode — ANDCC has no absolute addressing/);
  assert.match(hoverAt('\tLDA\t#5', 2).markdown, /\*\*Flags\*\* \(Δ changed, 0 cleared, – unchanged\)/);
  assert.match(hoverAt('\tCLR\t$20', 2).markdown, /\*\*Flags\*\* \(0 cleared, 1 set\)/);
});

test('checkOperand: illegal mode, register pair, missing and malformed operands', () => {
  const kind = (mn, op) => (checkOperand(mn, op) || {}).kind;
  assert.strictEqual(kind('LDA', '#5'), undefined);
  assert.strictEqual(kind('STA', '#5'), 'mode');
  assert.strictEqual(kind('CLR', ',X+'), 'mode');
  assert.strictEqual(kind('BEQ', '3,X'), 'mode');
  assert.strictEqual(kind('TFR', 'A,X'), 'pair');
  assert.strictEqual(kind('EXG', 'y,x'), undefined);
  assert.strictEqual(kind('LDA', undefined), 'missing');
  assert.strictEqual(kind('RTS', undefined), undefined);
  for (const op of ['#5,X', ',Z+', '3,PC', 'A,SP', ',X']) assert.strictEqual(kind('LDA', op), 'bad', op);
  assert.match(checkOperand('STA', '#5').message, /allowed: Adr  n,SP/);
  assert.match(checkOperand('LDA', ',X').message, /write 0,X/);
});

// --- Comparison with the real qaflisp ----------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

const EXAMPLE = { inh: '', imm: '#$12', abs: '$34', rel: '$34', nsp: '3,SP', nx: '3,X', ny: '3,Y', ax: 'A,X', ay: 'A,Y',
  xinc: ',X+', xdec: ',X-', incx: ',+X', decx: ',-X', yinc: ',Y+', ydec: ',Y-', incy: ',+Y', decy: ',-Y' };
const MEMORY_MODES = ['imm', 'abs', 'nsp', 'nx', 'ny', 'ax', 'ay', 'xinc', 'xdec', 'incx', 'decx', 'yinc', 'ydec', 'incy', 'decy'];
const operandOf = (v) => (v.mode === 'reg' ? v.operand : EXAMPLE[v.mode]);

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-instr-'));

  test('real qaflisp: every listed variant assembles with the listed opcode and length', async () => {
    const rows = [];
    for (const [mn, d] of Object.entries(INSTRUCTIONS)) for (const v of d.variants) rows.push({ mn, v });
    const src = '\tORG\t$20\n' + rows.map(({ mn, v }) => `\t${mn}${operandOf(v) ? '\t' + operandOf(v) : ''}`).join('\n') + '\n';
    const file = path.join(tmp, 'valid.sflisp');
    fs.writeFileSync(file, src);
    const r = await runQaflisp(realExe, file, { listFile: true });
    assert.deepStrictEqual(r.messages, [], r.output);
    const lst = fs.readFileSync(path.join(tmp, 'valid.lst'), 'utf8').split(/\r?\n/);
    rows.forEach(({ mn, v }, i) => {
      const lineNo = i + 2;
      const line = lst.find((l) => new RegExp(`\\s${lineNo}\\.\\s`).test(l));
      const hex = line.slice(0, line.indexOf(`${lineNo}.`)).trim().split(/\s+/).slice(1);
      assert.strictEqual(hex[0], v.opcode, `${mn} ${operandOf(v)}: opcode`);
      assert.strictEqual(hex.length, v.bytes, `${mn} ${operandOf(v)}: bytes`);
    });
  });

  test('real qaflisp: addressing modes that are not listed are rejected', async () => {
    const rows = [];
    for (const [mn, d] of Object.entries(INSTRUCTIONS)) {
      if (d.variants.some((v) => v.mode === 'inh' || v.mode === 'reg' || v.mode === 'rel')) continue;
      for (const mode of MEMORY_MODES) if (!d.variants.some((v) => v.mode === mode)) rows.push(`\t${mn}\t${EXAMPLE[mode]}`);
    }
    const file = path.join(tmp, 'invalid.sflisp');
    fs.writeFileSync(file, '\tORG\t$20\n' + rows.join('\n') + '\n');
    const r = await runQaflisp(realExe, file, {});
    const errorLines = new Set(r.messages.filter((m) => m.severity === 'error').map((m) => m.line));
    rows.forEach((row, i) => assert.ok(errorLines.has(i + 2), `qaflisp accepts ${row.trim()}, but it is not listed`));
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
