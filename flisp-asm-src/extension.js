const vscode = require('vscode');
const path = require('path');
const { findQaflisp, findDigiflispDirs, bundledQaflisp, runQaflisp } = require('./src/qaflisp');

let output;
let diagnostics;
let extensionRoot;

function activate(context) {
  extensionRoot = context.extensionPath;
  output = vscode.window.createOutputChannel('FLISP');
  diagnostics = vscode.languages.createDiagnosticCollection('qaflisp');
  context.subscriptions.push(output, diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand('flisp.assemble', (uri) => assembleCommand(uri)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'flisp') return;
      if (!vscode.workspace.getConfiguration('flisp', doc.uri).get('assembleOnSave')) return;
      assemble(doc, { fromSave: true });
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
  );
}

async function assembleCommand(uri) {
  let doc;
  if (uri instanceof vscode.Uri) {
    doc = await vscode.workspace.openTextDocument(uri);
  } else {
    doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  }
  if (!doc || doc.languageId !== 'flisp') {
    vscode.window.showWarningMessage('FLISP: Open a .sflisp file to assemble.');
    return;
  }
  if (doc.uri.scheme !== 'file') {
    vscode.window.showWarningMessage('FLISP: Only files on disk can be assembled.');
    return;
  }
  if (doc.isDirty && !(await doc.save())) return;
  await assemble(doc, { fromSave: false });
}

async function assemble(doc, { fromSave }) {
  if (!vscode.workspace.isTrusted) {
    if (!fromSave) vscode.window.showWarningMessage('FLISP: Assembling is disabled in untrusted workspaces.');
    return;
  }

  const config = vscode.workspace.getConfiguration('flisp', doc.uri);
  const sourceFile = doc.uri.fsPath;
  const exe = findQaflisp({
    configured: config.get('qaflispPath'),
    sourceDir: path.dirname(sourceFile),
    workspaceRoots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    envPath: process.env.PATH || '',
    digiflispDirs: findDigiflispDirs(),
    bundled: bundledQaflisp(extensionRoot),
  });
  if (!exe) {
    reportNotFound(config.get('qaflispPath'));
    return;
  }

  const options = {
    listFile: config.get('listFile'),
    warnings: config.get('warnings'),
    debugInfo: config.get('debugInfo'),
  };

  let result;
  try {
    result = await runQaflisp(exe, sourceFile, options);
  } catch (err) {
    output.appendLine(`Could not run ${exe}: ${err.message}`);
    output.show(true);
    vscode.window.showErrorMessage(`FLISP: Could not run qaflisp: ${err.message}`);
    return;
  }

  output.appendLine(`> ${exe} ${result.args.join(' ')}`);
  output.appendLine(result.output.trimEnd());
  output.appendLine('');

  publishDiagnostics(doc, result.messages);

  const errors = result.messages.filter((m) => m.severity === 'error').length;
  const warnings = result.messages.length - errors;
  if (errors > 0 || result.exitCode !== 0) {
    const count = errors || result.exitCode;
    vscode.window.setStatusBarMessage(`$(error) FLISP: ${count} error(s)`, 10000);
    if (!fromSave) {
      // Not awaited: the command is done once the diagnostics are published.
      vscode.window
        .showErrorMessage(`FLISP: ${path.basename(sourceFile)} has ${count} error(s).`, 'Show Problems', 'Show Output')
        .then((choice) => {
          if (choice === 'Show Problems') vscode.commands.executeCommand('workbench.actions.view.problems');
          if (choice === 'Show Output') output.show(true);
        });
    }
  } else {
    const suffix = warnings ? `, ${warnings} warning(s)` : '';
    vscode.window.setStatusBarMessage(`$(check) FLISP: assembled ${path.basename(sourceFile)}${suffix}`, 5000);
  }
}

function publishDiagnostics(doc, messages) {
  diagnostics.delete(doc.uri);
  const byFile = new Map();
  for (const m of messages) {
    // qaflisp echoes the path it was given; included files may show up with their own path.
    const file = path.isAbsolute(m.file) ? m.file : path.resolve(path.dirname(doc.uri.fsPath), m.file);
    const key = vscode.Uri.file(file).toString();
    if (!byFile.has(key)) byFile.set(key, []);
    const target = key === doc.uri.toString() ? doc : undefined;
    const diag = new vscode.Diagnostic(
      rangeFor(target, m),
      m.message,
      m.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
    );
    diag.source = 'qaflisp';
    byFile.get(key).push(diag);
  }
  for (const [key, list] of byFile) diagnostics.set(vscode.Uri.parse(key), list);
}

function rangeFor(doc, m) {
  const line = Math.max(0, m.line - 1);
  if (!doc || line >= doc.lineCount) return new vscode.Range(line, 0, line, 1000);
  const text = doc.lineAt(line).text;
  if (m.column !== undefined && m.column < text.length) {
    // Underline from the reported position to the end of that word.
    const rest = text.slice(m.column);
    const len = Math.max(1, rest.search(/\s|$/));
    return new vscode.Range(line, m.column, line, m.column + len);
  }
  const start = text.search(/\S/);
  return new vscode.Range(line, Math.max(0, start), line, text.length);
}

async function reportNotFound(configured) {
  const msg = configured
    ? `FLISP: qaflisp not found at "${configured}".`
    : process.platform === 'win32'
      ? 'FLISP: qaflisp not found. Put qaflisp.exe next to your source, in the workspace or on the PATH, or set its location.'
      : 'FLISP: qaflisp not found. Install DigiFlisp from www.gbgmv.se (it includes qaflisp), or set the location of qaflisp.';
  const choice = await vscode.window.showErrorMessage(msg, 'Set Location…', 'Open Settings');
  if (choice === 'Set Location…') {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Use this qaflisp',
      filters: process.platform === 'win32' ? { Programs: ['exe'] } : undefined,
    });
    if (picked && picked[0]) {
      await vscode.workspace
        .getConfiguration('flisp')
        .update('qaflispPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`FLISP: Using ${picked[0].fsPath}. Run the command again to assemble.`);
    }
  } else if (choice === 'Open Settings') {
    vscode.commands.executeCommand('workbench.action.openSettings', 'flisp.qaflispPath');
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
