// Tests inside a real VS Code (extension host): live diagnostics, hover, navigation, rename and
// the assemble command. Started by test/vscode/run.js, not directly. The workspace is a temporary
// folder; the source files are written there (qaflisp writes its output next to the source).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { findQaflisp, findDigiflispDirs, bundledQaflisp } = require('../../src/qaflisp');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const workspace = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openFile(name, text) {
  const file = path.join(workspace(), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  return doc;
}

// Diagnostics of a document as "source line: message", once `done` accepts them (live check is debounced).
async function diagnosticsWhen(doc, done, what) {
  let list = [];
  for (let i = 0; i < 50; i++) {
    list = vscode.languages.getDiagnostics(doc.uri).map((d) => `${d.source} ${d.range.start.line + 1}: ${d.message}`);
    if (done(list)) return list;
    await sleep(100);
  }
  assert.fail(`${what}; diagnostics: ${JSON.stringify(list)}`);
}

const hoverText = async (doc, line, character) => {
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, character));
  return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
};

const SOURCE = '\tORG\t$20\nStart\tLDA\t#1\nLoop\tDECA\n\tBNE\tLoop\n\tBRA\tStart\n';

test('live check: an undefined symbol is reported and disappears when it is fixed', async () => {
  const doc = await openFile('live.sflisp', `${SOURCE}\tBRA\tStrat\n`);
  await diagnosticsWhen(doc, (l) => l.some((d) => d.startsWith("flisp 6: Undefined symbol 'Strat'")), 'live error expected');
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(5, 5, 5, 10), 'Start');
  assert.ok(await vscode.workspace.applyEdit(edit));
  await diagnosticsWhen(doc, (l) => l.length === 0, 'no diagnostics expected after the fix');
});

test('hover: address of a label, description of an instruction', async () => {
  const doc = await openFile('hover.sflisp', SOURCE);
  assert.match(await hoverText(doc, 4, 6), /Start[\s\S]*\$20/);
  assert.match(await hoverText(doc, 1, 7), /LDA/);
});

test('definition, references, outline and rename', async () => {
  const doc = await openFile('navigate.sflisp', SOURCE);
  const at = new vscode.Position(3, 6); // "Loop" in "BNE Loop"
  const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, at);
  assert.deepStrictEqual(defs.map((d) => (d.range || d.targetRange).start.line), [2]);
  const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, at);
  assert.deepStrictEqual(refs.map((r) => r.range.start.line).sort(), [2, 3]);
  const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
  assert.deepStrictEqual(symbols.map((s) => s.name), ['Start', 'Loop']);
  const rename = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', doc.uri, at, 'Again');
  assert.deepStrictEqual(rename.get(doc.uri).map((e) => e.range.start.line).sort(), [2, 3]);
});

const qaflisp = findQaflisp({
  sourceDir: __dirname,
  workspaceRoots: [],
  envPath: process.env.PATH || '',
  digiflispDirs: findDigiflispDirs(),
  bundled: bundledQaflisp(path.resolve(__dirname, '..', '..')),
});

if (qaflisp) {
  test('assemble: qaflisp messages become diagnostics, the live check steps back, an edit drops them', async () => {
    const doc = await openFile('assemble.sflisp', `${SOURCE}\tBRA\tStrat\n\tEND\n`);
    await diagnosticsWhen(doc, (l) => l.some((d) => d.startsWith('flisp 6:')), 'live error expected before assembling');
    await vscode.commands.executeCommand('flisp.assemble', doc.uri);
    const after = await diagnosticsWhen(doc, (l) => l.some((d) => d.startsWith('qaflisp 6:')), 'qaflisp error expected in line 6');
    assert.ok(!after.some((d) => d.startsWith('flisp 6:')), `the live check must not repeat the qaflisp message: ${after}`);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(5, 5, 5, 10), 'Start');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await diagnosticsWhen(doc, (l) => l.length === 0, 'the edited line keeps no qaflisp message');
    await vscode.commands.executeCommand('flisp.assemble', doc.uri); // saves the edit first
    assert.deepStrictEqual(vscode.languages.getDiagnostics(doc.uri), []);
    assert.ok(fs.existsSync(path.join(workspace(), 'assemble.s19')), 'qaflisp writes its output next to the source');
  });

  test('assemble: messages reach the document in a folder with non-ASCII letters', async () => {
    const doc = await openFile('Övning å/umlaut.sflisp', `${SOURCE}\tBRA\tStrat\n\tEND\n`);
    await vscode.commands.executeCommand('flisp.assemble', doc.uri);
    await diagnosticsWhen(doc, (l) => l.some((d) => d.startsWith('qaflisp 6:')), 'qaflisp error expected in line 6');
    const phantom = vscode.languages.getDiagnostics().filter(([uri, list]) => list.length && !fs.existsSync(uri.fsPath));
    assert.deepStrictEqual(phantom.map(([uri]) => uri.fsPath), [], 'no diagnostics for files that do not exist');
  });
}

async function run() {
  await vscode.extensions.getExtension('janibert.flisp-asm').activate();
  const lines = [];
  let fails = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      lines.push(`ok    ${name}`);
    } catch (e) {
      fails++;
      lines.push(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  if (!qaflisp) lines.push('skip  assemble (qaflisp not found)');
  if (process.env.FLISP_TEST_RESULT) fs.writeFileSync(process.env.FLISP_TEST_RESULT, lines.join('\n') + '\n');
  if (fails) throw new Error(`${fails} test(s) failed`);
}

module.exports = { run };
