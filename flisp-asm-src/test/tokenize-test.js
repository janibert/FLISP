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

// [Datei, Zeile (eindeutiger Ausschnitt), Token (exakter Text), Scope-Anfang]
// Ein '!' vor dem Scope heisst: Das Token darf diesen Scope NICHT haben.
const expectations = [
  // Direktiven
  ['sample.sflisp', 'ORG     $20', 'ORG', 'keyword.other.directive'],
  ['sample.sflisp', 'OUTPORT     EQU', 'EQU', 'keyword.other.directive'],
  ['sample.sflisp', 'state_vector', 'FCB', 'keyword.other.directive'],
  ['sample.sflisp', 'Count', 'RMB', 'keyword.other.directive'],
  ['sample.sflisp', '"HELLO WORLD"', 'FCS', 'keyword.other.directive'],
  ['sample.sflisp', 'END', 'END', 'keyword.other.directive'],

  // Instruktionen
  ['sample.sflisp', 'Start       LDA', 'LDA', 'keyword.other.instruction'],
  ['sample.sflisp', 'L2          DECA', 'DECA', 'keyword.other.instruction'],
  ['sample.sflisp', 'CMPA    #2', 'CMPA', 'keyword.other.instruction'],
  ['sample.sflisp', 'LEASP', 'LEASP', 'keyword.other.instruction'],
  ['sample.sflisp', 'PSHC', 'PSHC', 'keyword.other.instruction'],
  ['sample.sflisp', '  PULC', 'PULC', 'keyword.other.instruction'],
  ['sample.sflisp', 'PULCC', 'PULCC', 'keyword.other.instruction'],
  ['sample.sflisp', 'ASLA', 'ASLA', 'keyword.other.instruction'],
  ['sample.sflisp', 'TFR', 'TFR', 'keyword.other.instruction'],
  ['sample.sflisp', 'EXG', 'EXG', 'keyword.other.instruction'],
  ['sample.sflisp', 'Delay       NOP', 'NOP', 'keyword.other.instruction'],
  ['sample.sflisp', 'ldx', 'ldx', 'keyword.other.instruction'],
  ['sample.sflisp', 'BEQ', 'BEQ', 'keyword.control.flow'],
  ['sample.sflisp', 'BRA', 'BRA', 'keyword.control.flow'],
  ['sample.sflisp', 'JSR', 'JSR', 'keyword.control.flow'],
  ['sample.sflisp', 'RTS', 'RTS', 'keyword.control.flow'],

  // Selbst definierte Laborinstruktionen: eigener Scope, kein Standard-Mnemonic
  ['sample.sflisp', 'MOVE', 'MOVE', 'entity.name.type.instruction.custom'],
  ['sample.sflisp', 'MOVE', 'MOVE', '!keyword.other.instruction'],
  ['sample.sflisp', 'CMJEQ', 'CMJEQ', 'entity.name.type.instruction.custom'],
  ['sample.sflisp', 'MOVE', 'OUTPORT', '!entity.name'],

  // Zahlen und Zeichen
  ['sample.sflisp', 'ORG     $20', '$20', 'constant.numeric.hex'],
  ['sample.sflisp', 'OUTPORT     EQU', '$FB', 'constant.numeric.hex'],
  ['sample.sflisp', 'state_vector', '%00000101', 'constant.numeric.binary'],
  ['sample.sflisp', 'CMPA    #2', '2', 'constant.numeric.decimal'],
  ['sample.sflisp', 'CMPA    #2', '#', 'keyword.operator.immediate'],
  ['sample.sflisp', "#'A'", "'A'", 'constant.character'],
  ['sample.sflisp', 'STA     -3,SP', '-3', 'constant.numeric.decimal'],
  ['sample.sflisp', '#K-1', '-', 'keyword.operator.arithmetic'],
  ['sample.sflisp', '#K-1', '1', 'constant.numeric.decimal'],

  // Adressierung
  ['sample.sflisp', 'LDA     2,X', ',', 'punctuation.separator.operand'],
  ['sample.sflisp', 'LDA     2,X', 'X', 'variable.language.register'],
  ['sample.sflisp', 'LDA     A,Y', 'A', 'variable.language.register'],
  ['sample.sflisp', 'LDA     ,X+', '+', 'keyword.operator.increment'],
  ['sample.sflisp', 'LDA     ,+Y', '+', 'keyword.operator.increment'],
  ['sample.sflisp', 'STA     ,-Y', '-', 'keyword.operator.increment'],
  ['sample.sflisp', 'LEASP', 'SP', 'variable.language.register'],
  ['sample.sflisp', 'TFR     A,CC', 'CC', 'variable.language.register'],
  ['sample.sflisp', 'TFR     A,CC', ',', 'punctuation.separator.operand'],
  ['sample.sflisp', 'EXG     X,SP', ',', 'punctuation.separator.operand'],

  // Labels
  ['sample.sflisp', 'Start       LDA', 'Start', 'entity.name.function.label'],
  ['sample.sflisp', 'L2          DECA', 'L2', 'entity.name.function.label'],
  ['sample.sflisp', 'Delay       NOP', 'Delay', 'entity.name.function.label'],
  ['sample.sflisp', 'MorseCode', 'MorseCode', 'entity.name.function.label'],
  ['sample.sflisp', 'state_vector', 'state_vector', 'entity.name.function.label'],
  ['sample.sflisp', 'OUTPORT     EQU', 'OUTPORT', 'entity.name.function.label'],
  ['sample.sflisp', 'LOOP:', 'LOOP', 'entity.name.function.label'],
  ['sample.sflisp', 'LOOP:', ':', 'punctuation.separator.label'],
  ['sample.sflisp', 'BEQ     Start', 'Start', '!entity.name.function.label'],
  ['sample.sflisp', 'LDA         #1', 'LDA', 'invalid.illegal'],

  // Kommentare: mit ';' und - wie bei qaflisp - alles nach dem Operand
  ['sample.sflisp', 'MorseCode', "; Morsecode fuer 'A'", 'comment.line'],
  ['sample.sflisp', 'MorseCode', '%01000000', 'constant.numeric.binary'],
  ['sample.sflisp', 'Delay       NOP', 'wartet einen Takt', 'comment.line'],
  ['sample.sflisp', 'RTS', 'Ruecksprung', 'comment.line'],
  ['sample.sflisp', '#K + 1', '+ 1', 'comment.line'],
  ['sample.sflisp', '"HELLO WORLD"', 'HELLO WORLD', 'string.quoted'],
  ['sample.sflisp', '"HELLO WORLD"', 'Text mit Leerzeichen', 'comment.line'],
  ['sample.sflisp', 'END', 'Start', '!comment'],
  ['sample.sflisp', 'END', 'Startadresse', 'comment.line'],

  // .fmem, so wie qaflisp es erzeugt
  ['sample.fmem', 'QAflisp', 'QAflisp - FLISP Absolute crossassembler, Version 1.3', 'comment.line'],
  ['sample.fmem', 'ClearAllMemory', '# ClearAllMemory', 'keyword.control.reset'],
  ['sample.fmem', 'ClearAllRegisters', '# ClearAllRegisters', 'keyword.control.reset'],
  ['sample.fmem', '20=05', '#setMemory', 'keyword.other.directive'],
  ['sample.fmem', '20=05', '20', 'constant.numeric.address'],
  ['sample.fmem', '20=05', '05', 'constant.numeric.hex'],
];

const files = {
  'sample.sflisp': 'source.flisp',
  'sample.fmem': 'source.fmem',
};

(async () => {
  const linesByFile = {};
  for (const [name, scope] of Object.entries(files)) {
    const grammar = await registry.loadGrammar(scope);
    const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
    let ruleStack = textmate.INITIAL;
    linesByFile[name] = text.split(/\r?\n/).map((line) => {
      const r = grammar.tokenizeLine(line, ruleStack);
      ruleStack = r.ruleStack;
      const tokens = r.tokens.map((t) => ({ text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes }));
      return { line, tokens };
    });
  }

  let fails = 0;
  for (const [file, marker, token, scope] of expectations) {
    const negate = scope.startsWith('!');
    const want = negate ? scope.slice(1) : scope;
    const line = linesByFile[file].find((l) => l.line.includes(marker));
    const tok = line && line.tokens.find((t) => t.text.trim() === token);
    let ok;
    if (!tok) ok = false;
    else {
      const has = tok.scopes.some((s) => s.startsWith(want));
      ok = negate ? !has : has;
    }
    if (!ok) {
      fails++;
      console.log(`FAIL  [${marker}] "${token}" -> ${negate ? 'darf nicht' : 'erwartet'} ${want}`);
      if (!line) console.log('        Zeile nicht gefunden');
      else line.tokens.forEach((t) => console.log(`        "${t.text}" ${t.scopes.slice(1).join(' ')}`));
    }
  }
  console.log(`\n${expectations.length - fails}/${expectations.length} Erwartungen erfuellt`);

  // Gegenprobe: Kein Mnemonic aus dem Handbuch darf ungetaggt durchrutschen.
  const plain = linesByFile['sample.sflisp']
    .flatMap((l) => l.tokens)
    .filter((t) => /^[A-Z]{2,5}$/.test(t.text.trim()) && t.scopes.length === 1);
  if (plain.length) {
    fails++;
    console.log('Ungetaggte Grossbuchstaben-Tokens:', plain.map((t) => t.text.trim()));
  }
  process.exit(fails ? 1 : 0);
})();
