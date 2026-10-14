// Tests for src/qaflisp.js. Runs without VS Code.
// The integration part runs the real qaflisp if one is found above this folder or on the PATH;
// otherwise it is skipped.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseOutput, buildArgs, candidatePaths, findDigiflispDirs, bundledQaflisp, findQaflisp, runQaflisp,
} = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Captured from qaflisp 1.3.
const SAMPLE_OUTPUT = [
  'C:\\work\\multi.sflisp (2) Error: Illegal character, Position[6]',
  'C:\\work\\multi.sflisp (3) Error: Illegal mnemonic',
  "C:\\work\\multi.sflisp (5) Error: Undefined symbol 'nirgendwo'",
  "C:\\work\\multi.sflisp (7) Error: symbol 'X1' previously defined at line 6",
  'C:\\work\\multi.sflisp (8) Error: Value (0x12C) is truncated',
  'C:/work/inc.sflisp (4) Warning: something odd',
  'C:\\work\\multi.sflisp (9)Fatal error: out of memory',
  '-- 6 error(s).',
].join('\r\n');

test('parseOutput reads errors, warnings, fatal errors and positions', () => {
  const m = parseOutput(SAMPLE_OUTPUT);
  assert.strictEqual(m.length, 7);
  assert.deepStrictEqual(m[0], {
    file: 'C:\\work\\multi.sflisp', line: 2, column: 6, severity: 'error', message: 'Illegal character',
  });
  assert.strictEqual(m[1].column, undefined);
  assert.strictEqual(m[1].message, 'Illegal mnemonic');
  assert.strictEqual(m[2].message, "Undefined symbol 'nirgendwo'");
  assert.strictEqual(m[4].message, 'Value (0x12C) is truncated');
  assert.strictEqual(m[5].severity, 'warning');
  assert.strictEqual(m[5].file, 'C:/work/inc.sflisp');
  assert.strictEqual(m[6].severity, 'error');
  assert.strictEqual(m[6].message, 'out of memory');
});

test('parseOutput handles paths with spaces and parentheses', () => {
  const m = parseOutput('C:\\My Labs (2026)\\lab 1.sflisp (12) Error: Illegal mnemonic');
  assert.strictEqual(m[0].file, 'C:\\My Labs (2026)\\lab 1.sflisp');
  assert.strictEqual(m[0].line, 12);
});

test('parseOutput ignores the summary and success lines', () => {
  assert.deepStrictEqual(parseOutput('-- No errors.\n-- 3 error(s).\n'), []);
});

test('buildArgs maps the options to qaflisp flags', () => {
  assert.deepStrictEqual(buildArgs({ listFile: true, warnings: true, debugInfo: false }, 'a.sflisp'), ['-L', '-w', 'a.sflisp']);
  assert.deepStrictEqual(buildArgs({}, 'a.sflisp'), ['a.sflisp']);
  assert.deepStrictEqual(buildArgs({ debugInfo: true }, 'a.sflisp'), ['-g', 'a.sflisp']);
});

test('candidatePaths uses only the configured path when set', () => {
  assert.deepStrictEqual(candidatePaths({ configured: 'X:\\tools\\qaflisp.exe', sourceDir: 'C:\\w\\a' }), ['X:\\tools\\qaflisp.exe']);
});

test('candidatePaths walks up to the workspace folder, then the PATH', () => {
  const root = path.resolve('/ws');
  const src = path.join(root, 'lab', 'part1');
  const bin = path.resolve('/bin');
  const exe = process.platform === 'win32' ? 'qaflisp.exe' : 'qaflisp';
  const c = candidatePaths({ sourceDir: src, workspaceRoots: [root], envPath: bin });
  const dirs = c.filter((p) => path.basename(p) === exe).map(path.dirname);
  assert.deepStrictEqual(dirs, [src, path.join(root, 'lab'), root, bin]);
});

if (process.platform !== 'win32') {
  test('candidatePaths (Linux, macOS): a native qaflisp anywhere comes before a qaflisp.exe', () => {
    const root = path.resolve('/ws');
    const c = candidatePaths({ sourceDir: root, workspaceRoots: [root], envPath: path.resolve('/bin') });
    assert.deepStrictEqual(c.map((p) => path.basename(p)), ['qaflisp', 'qaflisp', 'qaflisp.exe', 'qaflisp.exe']);
  });
}

test('candidatePaths does not walk above the source folder outside the workspace', () => {
  const src = path.resolve('/elsewhere/lab');
  const c = candidatePaths({ sourceDir: src, workspaceRoots: [path.resolve('/ws')] });
  const dirs = [...new Set(c.map(path.dirname))];
  assert.deepStrictEqual(dirs, [src, path.resolve('/ws')]);
});

test('findQaflisp returns the first existing candidate', () => {
  const root = path.resolve('/ws');
  const want = path.join(root, process.platform === 'win32' ? 'qaflisp.exe' : 'qaflisp');
  const found = findQaflisp({ sourceDir: path.join(root, 'lab'), workspaceRoots: [root] }, (p) => p === want);
  assert.strictEqual(found, want);
});

test('candidatePaths puts the DigiFlisp folders after the PATH and the bundled copy last', () => {
  const bin = path.resolve('/bin');
  const digi = path.resolve('/pf/GMV/DigiFlisp9');
  const bundled = path.resolve('/ext/bin/qaflisp.exe');
  const c = candidatePaths({ sourceDir: path.resolve('/src'), envPath: bin, digiflispDirs: [digi], bundled });
  const dirs = [...new Set(c.slice(0, -1).map(path.dirname))];
  assert.deepStrictEqual(dirs, [path.resolve('/src'), bin, digi]);
  assert.strictEqual(c[c.length - 1], bundled);
});

test('candidatePaths ignores the bundled copy when a path is configured', () => {
  const c = candidatePaths({ configured: 'X:\\q.exe', sourceDir: '/src', bundled: '/ext/bin/qaflisp.exe' });
  assert.deepStrictEqual(c, ['X:\\q.exe']);
});

test('findDigiflispDirs knows the Linux and macOS install locations', () => {
  assert.deepStrictEqual(findDigiflispDirs({}, undefined, 'linux'), ['/usr/share/digiflisp']);
  const mac = findDigiflispDirs({ HOME: '/Users/jan' }, undefined, 'darwin');
  assert.strictEqual(mac[0], '/Applications/Digiflisp.app/Contents/MacOS');
  assert.strictEqual(mac[1], path.join('/Users/jan', 'Applications', 'Digiflisp.app', 'Contents', 'MacOS'));
  assert.deepStrictEqual(findDigiflispDirs({}, undefined, 'freebsd'), []);
});

test('parseOutput reads the Linux build output (POSIX paths)', () => {
  // Captured from the Linux qaflisp of DigiFlisp 2.08, which exits with 0 even on errors.
  const m = parseOutput("/tmp/qt/multi.sflisp (2) Error: Illegal character, Position[6]\n/tmp/qt/multi.sflisp (5) Error: Undefined symbol 'nirgendwo'\n-- 6 error(s).\n");
  assert.deepStrictEqual(m.map((x) => [x.file, x.line, x.column]), [['/tmp/qt/multi.sflisp', 2, 6], ['/tmp/qt/multi.sflisp', 5, undefined]]);
});

if (process.platform === 'win32') {
  test('findDigiflispDirs lists GMV\\DigiFlisp* folders, newest first', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF' };
    const dirent = (name, dir = true) => ({ name, isDirectory: () => dir });
    const fake = {
      'C:\\PF86\\GMV': [dirent('DigiFlisp9'), dirent('DigiFlisp10'), dirent('Other'), dirent('DigiFlisp.txt', false)],
    };
    const readdir = (d) => {
      if (!fake[d]) throw new Error('ENOENT');
      return fake[d];
    };
    assert.deepStrictEqual(findDigiflispDirs(env, readdir), ['C:\\PF86\\GMV\\DigiFlisp10', 'C:\\PF86\\GMV\\DigiFlisp9']);
  });

  test('the bundled qaflisp.exe is in bin/', () => {
    const p = bundledQaflisp(path.join(__dirname, '..'));
    assert.ok(fs.existsSync(p), p + ' missing');
  });
}

// --- Integration with the real qaflisp ---------------------------------------

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-test-'));
  const write = (name, text) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, text);
    return p;
  };

  test('real qaflisp: a correct file has no messages and writes its output next to the source', async () => {
    const src = write('ok.sflisp', '\tORG\t$20\n\tLDA\t#1\n');
    const r = await runQaflisp(realExe, src, { listFile: true, warnings: true });
    assert.strictEqual(r.exitCode, 0, r.output);
    assert.deepStrictEqual(r.messages, []);
    for (const ext of ['.s19', '.lst', '.fmem']) {
      assert.ok(fs.existsSync(path.join(tmp, 'ok' + ext)), `ok${ext} missing`);
    }
  });

  test('real qaflisp: errors are parsed with line, column and message', async () => {
    const src = write('bad.sflisp', "\tORG\t$20\n\tLDA\t#'A\nLDA\t#1\n\tBRA\tnowhere\n");
    const r = await runQaflisp(realExe, src, { warnings: true });
    assert.strictEqual(r.exitCode, 3, r.output);
    assert.deepStrictEqual(
      r.messages.map((m) => [m.line, m.column, m.severity, m.message]),
      [
        [2, 6, 'error', 'Illegal character'],
        [3, undefined, 'error', 'Illegal mnemonic'],
        [4, undefined, 'error', "Undefined symbol 'nowhere'"],
      ]
    );
    assert.strictEqual(path.resolve(r.messages[0].file), path.resolve(src));
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
  if (!realExe) console.log('skip  real qaflisp tests (qaflisp not found)');
  else console.log(`      (real qaflisp: ${realExe})`);
  process.exit(fails ? 1 : 0);
})();
