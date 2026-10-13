// Language features for .sflisp files, built on src/symbols.js:
// Go to Definition, Find References, occurrence highlighting, Outline,
// hover, rename and the live symbol check while typing.
// For .fmem files: the syntax check of src/fmem.js while typing.

const vscode = require('vscode');
const { analyze, symbolAt, checkNewName } = require('./symbols');
const instructionHover = require('./instructionHover');
const { analyzeFmem } = require('./fmem');

const SELECTOR = { language: 'flisp' };
const KIND_TEXT = { code: 'label', data: 'data', constant: 'constant' };
const SYMBOL_KIND = {
  code: vscode.SymbolKind.Function,
  data: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
};

const cache = new Map(); // uri -> { version, analysis }

function analysisOf(doc) {
  const key = doc.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === doc.version) return hit.analysis;
  const analysis = analyze(doc.getText());
  cache.set(key, { version: doc.version, analysis });
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
    if (doc.languageId === 'fmem') {
      live.set(doc.uri, analyzeFmem(doc.getText()).map((d) => toDiagnostic(d, 'fmem')));
      return;
    }
    if (doc.languageId !== 'flisp') return;
    const analysis = analysisOf(doc);
    // Lines that already carry a qaflisp message keep only that message.
    const qaflispLines = new Set((qaflispDiagnostics.get(doc.uri) || []).map((d) => d.range.start.line));
    live.set(doc.uri, analysis.diagnostics.filter((d) => !qaflispLines.has(d.line)).map((d) => toDiagnostic(d, 'flisp')));
  }

  function refreshSoon(doc) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); refresh(doc); }, 300));
  }

  context.subscriptions.push(
    live,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refreshSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      live.delete(doc.uri);
      cache.delete(doc.uri.toString());
    }),

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
    })
  );

  vscode.workspace.textDocuments.forEach(refresh);
  return { refresh };
}

module.exports = { register };
