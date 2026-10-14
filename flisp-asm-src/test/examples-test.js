// Tests for the examples in test/examples/. Runs without VS Code.
// Every code line there ends with "; OK", "; ERROR" or "; WARNING": the live check must report
// exactly that. If qaflisp is found, it must report an error on every ERROR line and on no other
// line, apart from the listed exceptions. The files are read like the extension reads them
// (test/source-file.js): some examples are about encodings, a BOM and line endings.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSource, diagnosticsOf, editorLineOf, splitLines } = require('./source-file');
const { findQaflisp, runQaflisp } = require('../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const dir = path.join(__dirname, 'examples');
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sflisp')).sort();

// Lines where qaflisp differs on purpose (1-based): ERROR lines it does not report itself.
const QAFLISP_SILENT = {
  // after the "Undetermined size" in line 25 and the phase error in line 27 qaflisp stays silent
  '5-org-rmb-first-pass.sflisp': [26, 30],
};

const expectations = (source) => splitLines(source)
  .map((text, line) => ({ line, tag: (/;\s*(OK|ERROR|WARNING)\b/.exec(text) || [])[1] }))
  .filter((e) => e.tag);

for (const name of files) {
  test(`${name}: the live check reports what the comments say`, () => {
    const read = readSource(path.join(dir, name));
    const { source } = read;
    const diagnostics = diagnosticsOf(read);
    const wrong = [];
    for (const { line, tag } of expectations(source)) {
      const here = diagnostics.filter((d) => d.line === line);
      const got = here.some((d) => d.severity === 'error') ? 'ERROR' : here.length ? 'WARNING' : 'OK';
      if (got !== tag) wrong.push(`line ${line + 1}: expected ${tag}, got ${got} ${here.map((d) => d.message).join('; ')}`);
    }
    const tagged = new Set(expectations(source).map((e) => e.line));
    for (const d of diagnostics) if (!tagged.has(d.line)) wrong.push(`line ${d.line + 1} (no tag): ${d.message}`);
    assert.deepStrictEqual(wrong, []);
  });
}

const realExe = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [path.resolve(__dirname, '..', '..')],
  envPath: process.env.PATH || '',
});

if (realExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-examples-'));
  for (const name of files) {
    test(`${name}: qaflisp reports an error exactly on the ERROR lines`, async () => {
      const read = readSource(path.join(dir, name));
      const { source } = read;
      const file = path.join(tmp, name);
      fs.writeFileSync(file, read.bytes); // a copy, so that qaflisp's output files stay out of the repository
      const r = await runQaflisp(realExe, file, { warnings: true });
      const editorLine = editorLineOf(read);
      const theirs = new Set(r.messages.filter((m) => m.severity === 'error').map((m) => editorLine(m.line)));
      const silent = new Set((QAFLISP_SILENT[name] || []).map((n) => n - 1));
      const wrong = [];
      for (const { line, tag } of expectations(source)) {
        const expected = tag === 'ERROR' && !silent.has(line);
        if (theirs.has(line) !== expected) wrong.push(`line ${line + 1} (${tag}): qaflisp ${theirs.has(line) ? 'reports an error' : 'reports nothing'}`);
      }
      assert.deepStrictEqual(wrong, [], r.output);
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
