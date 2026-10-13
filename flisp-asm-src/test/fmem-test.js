// Tests for src/fmem.js. Runs without VS Code.
// If qaflisp is found, freshly generated .fmem files must pass the check without messages.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeFmem, formatFmemLine, formatFmemText } = require('../src/fmem');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const messages = (src) => analyzeFmem(src).map((d) => `${d.line + 1}:${d.severity}:${d.message}`);

test('qaflisp-output.fmem passes without messages', () => {
  assert.deepStrictEqual(messages(fs.readFileSync(path.join(__dirname, 'qaflisp-output.fmem'), 'utf8')), []);
});

test('commands are case-insensitive and may have blanks after # and around =', () => {
  assert.deepStrictEqual(messages(' # ClearAllMemory\n#clearallregisters\n#SETMEMORY 20=f0\n #setMemory  21=5 ; comment\n#setMemory 23 = 44\n'), []);
});

test('unknown commands, with a hint for typos', () => {
  assert.deepStrictEqual(messages('#setMemroy 20=05\n#foo 1\n'), [
    "1:error:Unknown command '#setMemroy' — DigiFlisp skips this line without a message; did you mean '#setMemory'?",
    "2:error:Unknown command '#foo' — DigiFlisp skips this line without a message; known commands: #setMemory, #setRegister, #ClearAllMemory, #ClearAllRegisters",
  ]);
});

const NOT_HEX = 'is not a hex number (digits 0–9, A–F) — DigiFlisp reports nothing and reads invalid digits as 0 (\'2G\' becomes 20)';

test('#setMemory: hex digits, missing parts, extra text', () => {
  const m = messages('#setMemory 2G=05\n#setMemory 120=05\n#setMemory 21 05\n#setMemory 22=\n#setMemory\n#setMemory 23=XY\n#setMemory 24=05 06\n');
  assert.deepStrictEqual(m, [
    `1:error:Address '2G' ${NOT_HEX}`,
    "2:error:Address '120' has too many digits — use 1–2 hex digits (00–FF)",
    "3:error:Missing '=' — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0",
    "4:error:Missing value after '=' — write #setMemory AA=DD (hex)",
    '5:error:Missing address and value — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0',
    `6:error:Value 'XY' ${NOT_HEX}`,
    "7:warning:Unexpected text after the value: '06'",
  ]);
});

// Hand test with DigiFlisp 2.08 (FLISP Monitor, "Load memory from file"), 2026-10-13.
// Result in DigiFlisp: $20=88 (line 11 overwrote line 4!), $21=22, $22=33, $23=44, $24=05,
// $25=00 and $26=00 (lines 9, 10 skipped), $27=99, $28=BB; registers all 00, CC=10 (no #setRegister
// form had an effect). DigiFlisp showed no message. The check must flag exactly the lines that
// DigiFlisp silently skips or misreads.
test('DigiFlisp hand test: flagged lines match what DigiFlisp skipped or misread', () => {
  const src = [
    'DigiFlisp .fmem test - which lines are accepted? (this header line has no \'#\')',
    ' # ClearAllMemory', ' # ClearAllRegisters',
    ' #setMemory  20=11', '#setmemory 21=22', '#SETMEMORY 22=33', '#setMemory 23 = 44', '#setMemory 24=5',
    '#setMemroy 25=66', 'setMemory 26=77', '#setMemory 2G=88', '#setMemory 27=99 ; trailing comment',
    '#setMemory 28=AA', '#setMemory 28=BB',
    '#setRegister A=A1', '#setRegister X B2', '#setRegister Y=C3', '#setRegister SP=D4', '#setRegister PC=20', '#setRegister CC=05',
  ].join('\n');
  const flagged = analyzeFmem(src).map((d) => `${d.line + 1}:${d.severity}`);
  assert.deepStrictEqual(flagged, [
    '9:error', // #setMemroy: skipped
    '10:warning', // no '#': skipped
    '11:error', // 2G: written to $20
    '14:warning', // 28 again: later value wins
    '15:warning', '16:warning', '17:warning', '18:warning', '19:warning', '20:warning', // #setRegister: no effect
  ]);
});

test('#setRegister is known but flagged as having no effect', () => {
  assert.deepStrictEqual(messages('#setRegister A=05\n'), [
    '1:warning:#setRegister had no effect in DigiFlisp 2.08 (tested forms: A=A1, X B2, SP=D4, PC=20, CC=05) — set registers in your program instead, e.g. LDSP #$FB',
  ]);
});

test('command without # and repeated addresses are warnings', () => {
  assert.deepStrictEqual(messages('setMemory 20=05\nQAflisp header\n#setMemory 20=05\n#setMemory 20=06\n# ClearAllMemory now\n'), [
    "1:warning:'setMemory' without '#' is ignored by DigiFlisp — write #setMemory",
    '4:warning:Address 20 is set again (first in line 3); the later value wins',
    '5:warning:#ClearAllMemory takes no arguments',
  ]);
});

// --- Column layout -----------------------------------------------------------------

test('formatFmemLine: command in column 0, argument at 14, comment at 24', () => {
  const f = (l) => formatFmemLine(l, [14, 24]);
  assert.strictEqual(f(' #setMemory  20=F0'), '#setMemory    20=F0');
  assert.strictEqual(f('#setmemory 21 = 22 ; note'), '#setmemory    21=22     ; note');
  assert.strictEqual(f('#setRegister A=05'), '#setRegister  A=05');
  assert.strictEqual(f(' # ClearAllMemory'), '# ClearAllMemory');
  assert.strictEqual(f('#ClearAllRegisters ; all'), '#ClearAllRegisters ; all');
  for (const l of ['QAflisp header line', '#setMemroy 25=66', '']) assert.strictEqual(f(l), l, `unchanged: ${l}`);
});

// Memory and register writes of a file, as DigiFlisp would apply them.
const writes = (src) => src.split(/\r?\n/)
  .map((l) => /^[ \t]*#[ \t]*setmemory[ \t]+([0-9A-Fa-f]{1,2})[ \t]*=[ \t]*([0-9A-Fa-f]{1,2})/i.exec(l))
  .filter(Boolean).map((m) => `${parseInt(m[1], 16)}=${parseInt(m[2], 16)}`);

test('formatting .fmem keeps all writes and messages and is stable', () => {
  const src = fs.readFileSync(path.join(__dirname, 'qaflisp-output.fmem'), 'utf8') +
    '#setmemory 21 = 22 ; note\n#setMemroy 25=66\n#setMemory 2G=88\n';
  const out = formatFmemText(src, [14, 24]);
  assert.deepStrictEqual(writes(out), writes(src));
  assert.deepStrictEqual(analyzeFmem(out).map((d) => `${d.line}:${d.message}`), analyzeFmem(src).map((d) => `${d.line}:${d.message}`));
  assert.strictEqual(formatFmemText(out, [14, 24]), out, 'formatting twice changes nothing');
});

// --- Fresh qaflisp output ------------------------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-fmem-'));
  test('real qaflisp: generated .fmem files pass without messages', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'running-light.sflisp'), 'utf8');
    const file = path.join(tmp, 'running-light.sflisp');
    fs.writeFileSync(file, src);
    await runQaflisp(realExe, file, {});
    const fmem = fs.readFileSync(path.join(tmp, 'running-light.fmem'), 'utf8');
    assert.ok(/#setMemory/.test(fmem), 'qaflisp wrote a .fmem');
    assert.deepStrictEqual(messages(fmem), []);
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
  if (!realExe) console.log('skip  fresh qaflisp output (qaflisp not found)');
  process.exit(fails ? 1 : 0);
})();
