// Language features for .sflisp files, built on src/symbols.js:
// Go to Definition, Find References, occurrence highlighting, Outline,
// hover, rename and the live symbol check while typing.
// For .fmem files: the syntax check of src/fmem.js while typing.

const fs = require('fs');
const vscode = require('vscode');
const { analyze, symbolAt, checkNewName } = require('./symbols');
const { describeValue } = require('./checks');
const instructionHover = require('./instructionHover');
const { analyzeFmem, normalizeFmemColumns, formatFmemLine, fmemCompletionsAt, fmemCommandTakesArgument } = require('./fmem');
const format = require('./format');
const { completionsAt, fieldAt } = require('./completion');
const { inspectBytes, encodingFor, fileProblems } = require('./fileBytes');

const COMPLETION_KIND = {
  mnemonic: vscode.CompletionItemKind.Keyword,
  directive: vscode.CompletionItemKind.Keyword,
  lab: vscode.CompletionItemKind.Keyword,
  code: vscode.CompletionItemKind.Function,
  data: vscode.CompletionItemKind.Variable,
  constant: vscode.CompletionItemKind.Constant,
  register: vscode.CompletionItemKind.EnumMember,
  undefined: vscode.CompletionItemKind.Reference,
};

const SELECTOR = { language: 'flisp' };
const FMEM = { language: 'fmem' };
// Documents that get live diagnostics: the user's files, not e.g. the git: copy in a diff view
// (its messages would show up twice in Problems).
const CHECKED_SCHEMES = new Set(['file', 'untitled', 'vscode-vfs', 'vscode-remote']);
const KIND_TEXT = { code: 'label', data: 'data', constant: 'constant' };
const SYMBOL_KIND = {
  code: vscode.SymbolKind.Function,
  data: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
};

const cache = new Map(); // uri -> { version, encoding, analysis }
const fileInfo = new Map(); // uri -> inspectBytes() of the file on disk (undefined: not readable)

// Reads the bytes of the file qaflisp will read; done on refresh while the editor shows the
// file as it is on disk (a changed document keeps the last result: encoding and BOM stay).
function updateFileInfo(doc) {
  const key = doc.uri.toString();
  if (doc.isDirty && fileInfo.has(key)) return;
  let info;
  try {
    if (doc.uri.scheme === 'file' && fs.statSync(doc.uri.fsPath).size < 4e6) info = inspectBytes(fs.readFileSync(doc.uri.fsPath));
  } catch (e) {
    info = undefined; // not on disk (yet)
  }
  fileInfo.set(key, info);
}

const encodingOf = (doc) => encodingFor(fileInfo.get(doc.uri.toString()), vscode.workspace.getConfiguration('files', doc.uri).get('encoding'));

function analysisOf(doc) {
  const key = doc.uri.toString();
  const encoding = encodingOf(doc);
  const hit = cache.get(key);
  if (hit && hit.version === doc.version && hit.encoding === encoding) return hit.analysis;
  const analysis = analyze(doc.getText(), { encoding });
  cache.set(key, { version: doc.version, encoding, analysis });
  return analysis;
}

const rangeOf = (s) => new vscode.Range(s.line, s.start, s.line, s.end);

function occurrences(analysis, name) {
  return {
    defs: analysis.byName.get(name) || [],
    refs: analysis.references.filter((r) => r.name === name),
  };
}

function register(context, qaflispDiagnostics) {
  const live = vscode.languages.createDiagnosticCollection('flisp');
  const timers = new Map();

  const toDiagnostic = (d, source) => {
    const diag = new vscode.Diagnostic(rangeOf(d), d.message,
      d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    diag.source = source;
    return diag;
  };

  function refresh(doc) {
    if (doc.isClosed || !CHECKED_SCHEMES.has(doc.uri.scheme)) return;
    if (doc.languageId === 'fmem') {
      live.set(doc.uri, analyzeFmem(doc.getText()).map((d) => toDiagnostic(d, 'fmem')));
      return;
    }
    if (doc.languageId !== 'flisp') return;
    updateFileInfo(doc);
    const analysis = analysisOf(doc);
    // Lines that already carry a qaflisp message keep only that message.
    const qaflispLines = new Set((qaflispDiagnostics.get(doc.uri) || []).map((d) => d.range.start.line));
    const info = fileInfo.get(doc.uri.toString());
    // BOM and line endings: always shown, they explain what qaflisp reports (code: for the quick fixes)
    const file = info ? fileProblems(info, { dirty: doc.isDirty, lineLength: (l) => (l < doc.lineCount ? doc.lineAt(l).text.length : 0) }) : [];
    live.set(doc.uri, [
      ...file.map((d) => Object.assign(toDiagnostic(d, 'flisp'), { code: d.kind })),
      ...analysis.diagnostics.filter((d) => !qaflispLines.has(d.line)).map((d) => toDiagnostic(d, 'flisp')),
    ]);
  }

  function refreshSoon(doc) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); refresh(doc); }, 300));
  }

  context.subscriptions.push(
    live,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh), // the bytes on disk may have changed (encoding, line endings)
    vscode.workspace.onDidChangeTextDocument((e) => refreshSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      clearTimeout(timers.get(key)); // a pending refresh would bring the diagnostics back
      timers.delete(key);
      live.delete(doc.uri);
      cache.delete(key);
      fileInfo.delete(key);
    }),

    // Quick fixes for what VS Code hides but qaflisp reads (src/fileBytes.js).
    vscode.languages.registerCodeActionsProvider(SELECTOR, {
      provideCodeActions(doc, range, ctx) {
        const actions = [];
        const add = (title, command, diagnostic) => {
          const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          action.command = { title, command };
          action.diagnostics = [diagnostic];
          actions.push(action);
        };
        for (const d of ctx.diagnostics) {
          if (d.source !== 'flisp') continue;
          if (d.code === 'loneCr' || d.code === 'crLineEnds') add('Save with uniform line endings', 'workbench.action.files.save', d);
          if (d.code === 'bom' || d.code === 'utf16') add('Change the encoding (Save with Encoding → UTF-8)', 'workbench.action.editor.changeEncoding', d);
        }
        return actions;
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),

    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(doc, pos) {
        const a = analysisOf(doc);
        const sym = symbolAt(a, pos.line, pos.character);
        if (!sym) return undefined;
        return occurrences(a, sym.name).defs.map((d) => new vscode.Location(doc.uri, rangeOf(d)));
      },
    }),

    vscode.languages.registerReferenceProvider(SELECTOR, {
      provideReferences(doc, pos, ctx) {
        const a = analysisOf(doc);
        const sym = symbolAt(a, pos.line, pos.character);
        if (!sym) return undefined;
        const { defs, refs } = occurrences(a, sym.name);
        return [...(ctx.includeDeclaration ? defs : []), ...refs].map((s) => new vscode.Location(doc.uri, rangeOf(s)));
      },
    }),

    vscode.languages.registerDocumentHighlightProvider(SELECTOR, {
      provideDocumentHighlights(doc, pos) {
        const a = analysisOf(doc);
        const sym = symbolAt(a, pos.line, pos.character);
        if (!sym) return undefined;
        const { defs, refs } = occurrences(a, sym.name);
        return [
          ...defs.map((d) => new vscode.DocumentHighlight(rangeOf(d), vscode.DocumentHighlightKind.Write)),
          ...refs.map((r) => new vscode.DocumentHighlight(rangeOf(r), vscode.DocumentHighlightKind.Read)),
        ];
      },
    }),

    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(doc) {
        return analysisOf(doc).definitions.map((d) => new vscode.DocumentSymbol(
          d.name,
          d.mnemonic ? `${d.mnemonic.toUpperCase()}${d.operand ? ' ' + d.operand : ''}` : '',
          SYMBOL_KIND[d.kind],
          new vscode.Range(d.line, 0, d.line, d.text.length),
          rangeOf(d)
        ));
      },
    }),

    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        const a = analysisOf(doc);
        const sym = symbolAt(a, pos.line, pos.character);
        if (!sym) {
          // Not a symbol: maybe a mnemonic or directive.
          const h = instructionHover.hoverAt(doc.lineAt(pos.line).text, pos.character);
          if (!h) return undefined;
          return new vscode.Hover(new vscode.MarkdownString(h.markdown), new vscode.Range(pos.line, h.start, pos.line, h.end));
        }
        const { defs, refs } = occurrences(a, sym.name);
        const md = new vscode.MarkdownString();
        if (defs.length === 0) {
          md.appendMarkdown(`**${sym.name}** — undefined symbol`);
        } else {
          md.appendMarkdown(`**${sym.name}** — ${KIND_TEXT[defs[0].kind]}`);
          if (defs.length > 1) md.appendMarkdown(` (defined ${defs.length} times)`);
          else {
            // address of a label or value of a constant, as qaflisp computes it (src/layout.js)
            const v = a.valueOf(sym.name);
            if (v !== undefined) md.appendMarkdown(` · ${defs[0].kind === 'constant' ? 'value' : 'address'} ${describeValue(v)}`);
          }
          for (const d of defs) md.appendCodeblock(d.text.trimEnd(), 'flisp');
        }
        md.appendMarkdown(`\n\n${refs.length} reference${refs.length === 1 ? '' : 's'}`);
        return new vscode.Hover(md, new vscode.Range(pos.line, sym.start, pos.line, sym.end));
      },
    }),

    vscode.languages.registerRenameProvider(SELECTOR, {
      prepareRename(doc, pos) {
        const sym = symbolAt(analysisOf(doc), pos.line, pos.character);
        if (!sym) throw new Error('Only labels and EQU constants can be renamed.');
        return { range: new vscode.Range(pos.line, sym.start, pos.line, sym.end), placeholder: sym.name };
      },
      provideRenameEdits(doc, pos, newName) {
        const a = analysisOf(doc);
        const sym = symbolAt(a, pos.line, pos.character);
        if (!sym) throw new Error('Only labels and EQU constants can be renamed.');
        const problem = checkNewName(a, sym.name, newName);
        if (problem) throw new Error(problem);
        const { defs, refs } = occurrences(a, sym.name);
        const edit = new vscode.WorkspaceEdit();
        for (const s of [...defs, ...refs]) edit.replace(doc.uri, rangeOf(s), newName);
        return edit;
      },
    }),

    // Completion depending on the column of the cursor (src/completion.js).
    vscode.languages.registerCompletionItemProvider(SELECTOR, {
      provideCompletionItems(doc, pos) {
        const items = completionsAt(doc.lineAt(pos.line).text, pos.character, analysisOf(doc));
        return items.map((x) => {
          const item = new vscode.CompletionItem(x.label, COMPLETION_KIND[x.kind]);
          item.detail = x.detail;
          item.sortText = x.sort;
          return item;
        });
      },
    }, '#', ','),

    // .fmem: only the four commands, and only in the command column.
    vscode.languages.registerCompletionItemProvider(FMEM, {
      provideCompletionItems(doc, pos) {
        const { start, items } = fmemCompletionsAt(doc.lineAt(pos.line).text, pos.character);
        const range = new vscode.Range(pos.line, start, pos.line, pos.character);
        return items.map((x, i) => {
          const item = new vscode.CompletionItem(x.insert, vscode.CompletionItemKind.Keyword);
          item.insertText = x.insert;
          item.filterText = x.filter;
          item.range = range;
          item.detail = x.detail;
          item.sortText = String(i);
          return item;
        });
      },
    }, '#'),

    // Tab while the suggestion list is open: accept, and in the label or mnemonic column
    // go on to the next column, so one Tab is enough (in the operand an expression may continue).
    vscode.commands.registerCommand('flisp.acceptSuggestionAndNextColumn', async () => {
      await vscode.commands.executeCommand('acceptSelectedSuggestion');
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const pos = editor.selection.active;
      if (editor.document.languageId === 'fmem') {
        // #setMemory / #setRegister: on to the argument column
        if (fmemCommandTakesArgument(editor.document.lineAt(pos.line).text.slice(0, pos.character))) {
          await vscode.commands.executeCommand('flisp.nextColumn');
        }
        return;
      }
      if (editor.document.languageId !== 'flisp') return;
      const { field } = fieldAt(editor.document.lineAt(pos.line).text, pos.character);
      if (field === 'label' || field === 'mnemonic') await vscode.commands.executeCommand('flisp.nextColumn');
    }),

    // Column layout: formatter and Tab / Shift+Tab to the next / previous column.
    vscode.languages.registerDocumentFormattingEditProvider([SELECTOR, FMEM], {
      provideDocumentFormattingEdits: (doc) => formatEdits(doc, 0, doc.lineCount - 1),
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider([SELECTOR, FMEM], {
      provideDocumentRangeFormattingEdits: (doc, range) => formatEdits(doc, range.start.line, range.end.line),
    }),
    vscode.commands.registerTextEditorCommand('flisp.nextColumn', (editor, edit) => {
      const columns = columnsFor(editor.document);
      const tabSize = Number(editor.options.tabSize) || 4;
      for (const sel of editor.selections) {
        const text = editor.document.lineAt(sel.active.line).text;
        const col = format.visualColumn(text, sel.active.character, tabSize);
        edit.insert(sel.active, ' '.repeat(format.nextStop(col, columns, tabSize) - col));
      }
    }),
    vscode.commands.registerCommand('flisp.previousColumn', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const columns = columnsFor(editor.document);
      const tabSize = Number(editor.options.tabSize) || 4;
      const deletions = [];
      const moves = editor.selections.map((sel) => {
        const pos = sel.active;
        const text = editor.document.lineAt(pos.line).text;
        const col = format.visualColumn(text, pos.character, tabSize);
        const stop = format.previousStop(col, columns, tabSize);
        // Character position of the stop (lines with tabs: walk back until the visual column fits).
        let ch = pos.character;
        while (ch > 0 && format.visualColumn(text, ch, tabSize) > stop) ch--;
        const between = text.slice(ch, pos.character);
        // Only blanks before the cursor: remove them; otherwise just move the cursor.
        if (/^[ \t]+$/.test(between)) deletions.push(new vscode.Range(pos.line, ch, pos.line, pos.character));
        return new vscode.Position(pos.line, ch);
      });
      if (deletions.length && !(await editor.edit((edit) => deletions.forEach((r) => edit.delete(r))))) return;
      // Every cursor goes to its stop, also those without blanks before them; positions shift
      // by the blanks deleted further left on the same line.
      const shift = (p) => deletions
        .filter((r) => r.start.line === p.line && r.end.character <= p.character)
        .reduce((n, r) => n + r.end.character - r.start.character, 0);
      editor.selections = moves.map((p) => {
        const ch = p.character - shift(p);
        return new vscode.Selection(p.line, ch, p.line, ch);
      });
    })
  );

  // Tab stops: .sflisp label/mnemonic/operand/comment, .fmem command/argument/comment.
  function columnsFor(doc) {
    const config = vscode.workspace.getConfiguration('flisp', doc.uri);
    return doc.languageId === 'fmem'
      ? normalizeFmemColumns(config.get('fmemColumns'))
      : format.normalizeColumns(config.get('columns'));
  }

  function formatEdits(doc, first, last) {
    const columns = columnsFor(doc);
    const edits = [];
    for (let line = first; line <= last; line++) {
      const old = doc.lineAt(line).text;
      const neu = doc.languageId === 'fmem' ? formatFmemLine(old, columns) : format.formatLine(old, columns);
      if (neu !== old) edits.push(vscode.TextEdit.replace(doc.lineAt(line).range, neu));
    }
    return edits;
  }

  vscode.workspace.textDocuments.forEach(refresh);
  return { refresh };
}

module.exports = { register };
