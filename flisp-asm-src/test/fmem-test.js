// Tests for src/fmem.js. Runs without VS Code.
// If qaflisp is found, freshly generated .fmem files must pass the check without messages.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeFmem } = require('../src/fmem');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const messages = (src) => analyzeFmem(src).map((d) => `${d.line + 1}:${d.severity}:${d.message}`);

test('qaflisp-output.fmem passes without messages', () => {
  assert.deepStrictEqual(messages(fs.readFileSync(path.join(__dirname, 'qaflisp-output.fmem'), 'utf8')), []);
});

test('commands are case-insensitive and may have blanks after #', () => {
  assert.deepStrictEqual(messages(' # ClearAllMemory\n#clearallregisters\n#SETMEMORY 20=f0\n #setMemory  21=5 ; comment\n#setRegister A=05\n'), []);
});

test('unknown commands, with a hint for typos', () => {
  assert.deepStrictEqual(messages('#setMemroy 20=05\n#foo 1\n'), [
    "1:error:Unknown command '#setMemroy' — did you mean '#setMemory'?",
    "2:error:Unknown command '#foo' — DigiFlisp knows #setMemory, #setRegister, #ClearAllMemory, #ClearAllRegisters",
  ]);
});

test('#setMemory: hex digits, missing parts, extra text', () => {
  const m = messages('#setMemory 2G=05\n#setMemory 120=05\n#setMemory 21 05\n#setMemory 22=\n#setMemory\n#setMemory 23=XY\n#setMemory 24=05 06\n');
  assert.deepStrictEqual(m, [
    "1:error:Address '2G' is not a hex number (digits 0–9, A–F)",
    "2:error:Address '120' has too many digits — use 1–2 hex digits (00–FF)",
    "3:error:Missing '=' — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0",
    "4:error:Missing value after '=' — write #setMemory AA=DD (hex)",
    '5:error:Missing address and value — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0',
    "6:error:Value 'XY' is not a hex number (digits 0–9, A–F)",
    "7:warning:Unexpected text after the value: '06'",
  ]);
});

test('command without # and repeated addresses are warnings', () => {
  assert.deepStrictEqual(messages('setMemory 20=05\nQAflisp header\n#setMemory 20=05\n#setMemory 20=06\n# ClearAllMemory now\n'), [
    "1:warning:'setMemory' without '#' is ignored by DigiFlisp — write #setMemory",
    '4:warning:Address 20 is set again (first in line 3); the later value wins',
    '5:warning:#ClearAllMemory takes no arguments',
  ]);
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
