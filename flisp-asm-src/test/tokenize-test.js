const fs = require('fs');
const path = require('path');
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

// Projektwurzel: ein Verzeichnis ueber diesem Testordner.
const EXT = path.join(__dirname, '..');
const wasm = fs.readFileSync(path.join(require.resolve('vscode-oniguruma'), '../onig.wasm'));

const vscodeOnigurumaLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const registry = new textmate.Registry({
  onigLib: vscodeOnigurumaLib,
  loadGrammar: (scope) => {
    const map = {
      'source.flisp': path.join(EXT, 'syntaxes/flisp.tmLanguage.json'),
      'source.fmem': path.join(EXT, 'syntaxes/fmem.tmLanguage.json'),
    };
    if (!map[scope]) return Promise.resolve(null);
    const raw = fs.readFileSync(map[scope], 'utf8');
    return Promise.resolve(textmate.parseRawGrammar(raw, map[scope]));
  },
});

// Was ein Token bekommen MUSS: [Datei, Zeilenausschnitt, Text, erwarteter Scope-Teil]
const expectations = [
  ['sample.sflisp', 'ORG', 'keyword.other.directive'],
  ['sample.sflisp', 'EQU', 'keyword.other.directive'],
  ['sample.sflisp', 'FCB', 'keyword.other.directive'],
  ['sample.sflisp', 'RMB', 'keyword.other.directive'],
  ['sample.sflisp', 'FCS', 'keyword.other.directive'],
  ['sample.sflisp', 'LDA', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'DECA', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'CMPA', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'PULCC', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'LSLA', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'TFR', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'NOP', 'keyword.operator.mnemonic'],
  ['sample.sflisp', 'BEQ', 'keyword.control.flow'],
  ['sample.sflisp', 'BRA', 'keyword.control.flow'],
  ['sample.sflisp', 'JSR', 'keyword.control.flow'],
  ['sample.sflisp', 'RTS', 'keyword.control.flow'],
  ['sample.sflisp', '$20', 'constant.numeric.hex'],
  ['sample.sflisp', '$FB', 'constant.numeric.hex'],
  ['sample.sflisp', '%00000101', 'constant.numeric.binary'],
  ['sample.sflisp', '#', 'keyword.operator.immediate'],
  ['sample.sflisp', 'Start', 'entity.name.function.label'],
  ['sample.sflisp', 'L2', 'entity.name.function.label'],
  ['sample.sflisp', 'Delay', 'entity.name.function.label'],
  ['sample.sflisp', 'MorseCode', 'entity.name.function.label'],
  ['sample.sflisp', '; Verzoegerung', 'comment.line'],
  ['sample.sflisp', 'HELLO', 'string.quoted'],
  ['sample.sflisp', 'state_vector', 'entity.name.function.label'],
  ['sample.sflisp', 'OUTPORT', 'entity.name.function.label'],
  ['fmem.fmem', '#setMemory', 'keyword.other.directive'],
];

const files = {
  'sample.sflisp': ['source.flisp', fs.readFileSync(path.join(__dirname, 'sample.sflisp'), 'utf8')],
  'fmem.fmem': ['source.fmem', '#setMemory 20=DF\n#setMemory FF=20\n'],
};

(async () => {
  const tokensByFile = {};
  for (const [name, [scope, text]] of Object.entries(files)) {
    const grammar = await registry.loadGrammar(scope);
    let ruleStack = textmate.INITIAL;
    const toks = [];
    for (const line of text.split('\n')) {
      const r = grammar.tokenizeLine(line, ruleStack);
      for (const t of r.tokens) {
        toks.push({ text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes });
      }
      ruleStack = r.ruleStack;
    }
    tokensByFile[name] = toks;
  }

  let fails = 0;
  for (const [file, snippet, wantScope] of expectations) {
    const hit = tokensByFile[file].some(
      (t) => t.text.includes(snippet.trim()) && t.scopes.some((s) => s.startsWith(wantScope))
    );
    if (!hit) {
      fails++;
      const near = tokensByFile[file].filter((t) => t.text.includes(snippet.trim()));
      console.log(`FAIL  "${snippet}" -> erwartet ${wantScope}`);
      near.slice(0, 3).forEach((t) => console.log(`        gefunden: "${t.text}" ${JSON.stringify(t.scopes)}`));
    }
  }
  console.log(`\n${expectations.length - fails}/${expectations.length} Erwartungen erfuellt`);

  // Gegenprobe: nichts darf voellig ungetaggt durchrutschen, was ein Mnemonic ist
  const plain = tokensByFile['sample.sflisp'].filter(
    (t) => /^[A-Z]{2,5}$/.test(t.text.trim()) && t.scopes.length === 1
  );
  if (plain.length) console.log('Ungetaggte Grossbuchstaben-Tokens:', plain.map((t) => t.text.trim()));
  process.exit(fails ? 1 : 0);
})();
