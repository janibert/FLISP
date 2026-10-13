// Tests for src/fileBytes.js (BOM, line endings, encoding of the file on disk). Runs without VS Code.
// If qaflisp is found, its behaviour that the messages describe is checked too.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectBytes, encodingFor, fileProblems } = require('../src/fileBytes');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const latin1 = (s) => Buffer.from(s, 'latin1');
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const MIXED = '\tORG\t$20\r\n\tNOP\r\tNOP\n\tLDA\tNix\r\n\tEND\r\n'; // VS Code: line 1 ends with a lone CR

const problems = (bytes, dirty = false) => fileProblems(inspectBytes(bytes), { dirty, lineLength: () => 5 }).map((d) => [d.line, d.severity, d.kind]);

test('BOM: UTF-8 is an error on line 1, UTF-16 cannot be read at all', () => {
  assert.deepStrictEqual(problems(Buffer.concat([BOM, latin1('\tNOP\r\n')])), [[0, 'error', 'bom']]);
  assert.deepStrictEqual(problems(Buffer.from([0xFF, 0xFE, 0x09, 0x00])), [[0, 'error', 'utf16']]);
  assert.deepStrictEqual(problems(latin1('\tNOP\r\n\tNOP\n')), []);
});

test('line endings: lone CRs at their lines (numbered like VS Code), CR only, nothing while edited', () => {
  assert.deepStrictEqual(inspectBytes(latin1(MIXED)).loneCrLines, [1]);
  assert.deepStrictEqual(problems(latin1(MIXED)), [[1, 'warning', 'loneCr']]);
  assert.deepStrictEqual(problems(latin1('\tORG\t$20\r\tNOP\r')), [[0, 'warning', 'crLineEnds']]);
  assert.deepStrictEqual(problems(latin1(MIXED), true), []);
  assert.deepStrictEqual(problems(Buffer.concat([BOM, latin1(MIXED)]), true), [[0, 'error', 'bom']]);
});

test('encoding: from the bytes if they contain non-ASCII, otherwise the files.encoding setting', () => {
  assert.strictEqual(inspectBytes(Buffer.from('; Övning\n', 'utf8')).encoding, 'utf8');
  assert.strictEqual(inspectBytes(latin1('; Övning\n')).encoding, 'singleByte');
  assert.strictEqual(inspectBytes(latin1('; ASCII\n')).encoding, undefined);
  assert.strictEqual(encodingFor(inspectBytes(latin1('; ASCII\n')), 'windows1252'), 'singleByte');
  assert.strictEqual(encodingFor(inspectBytes(latin1('; ASCII\n')), 'utf8'), 'utf8');
  assert.strictEqual(encodingFor(undefined, undefined), 'utf8');
  assert.strictEqual(encodingFor(inspectBytes(latin1('; Övning\n')), 'utf8'), 'singleByte');
});

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-bytes-'));
  const assemble = async (name, bytes) => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, bytes);
    return (await runQaflisp(realExe, file, {})).messages.map((m) => [m.line, m.message]);
  };

  test('real qaflisp: a BOM breaks line 1; a lone CR joins two lines', async () => {
    assert.deepStrictEqual(await assemble('bom.sflisp', Buffer.concat([BOM, latin1('; comment\r\n\tNOP\r\n')])), [[1, 'Illegal mnemonic']]);
    // "LDA Nix" is line 4 in VS Code, but line 3 for qaflisp
    assert.deepStrictEqual(await assemble('mixed.sflisp', latin1(MIXED)), [[3, "Undefined symbol 'Nix'"]]);
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
  if (!realExe) console.log('skip  real qaflisp (qaflisp not found)');
  process.exit(fails ? 1 : 0);
})();
