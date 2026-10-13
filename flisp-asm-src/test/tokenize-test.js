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
  ['sample.sflisp', 'ORG     $20', 'ORG', 'support.type.directive'],
  ['sample.sflisp', 'OUTPORT     EQU', 'EQU', 'support.type.directive'],
  ['sample.sflisp', 'state_vector', 'FCB', 'support.type.directive'],
  ['sample.sflisp', 'Count', 'RMB', 'support.type.directive'],
  ['sample.sflisp', '"HELLO WORLD"', 'FCS', 'support.type.directive'],
  ['sample.sflisp', 'END', 'END', 'support.type.directive'],
  // Directives and instructions must not share a scope family (themes would colour them alike)
  ['sample.sflisp', 'ORG     $20', 'ORG', '!keyword'],
  ['sample.sflisp', 'Start       LDA', 'LDA', '!support.type'],

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

  // Symbols used in operands
  ['sample.sflisp', 'BEQ     Start', 'Start', 'variable.parameter.symbol'],
  ['sample.sflisp', 'STA     OUTPORT', 'OUTPORT', 'variable.parameter.symbol'],
  ['sample.sflisp', 'JSR     Delay', 'Delay', 'variable.parameter.symbol'],
  ['sample.sflisp', '#K-1', 'K', 'variable.parameter.symbol'],
  ['sample.sflisp', 'MOVE    #1,OUTPORT', 'OUTPORT', 'variable.parameter.symbol'],
  ['sample.sflisp', 'END     Start', 'Start', 'variable.parameter.symbol'],
  ['sample.sflisp', 'LDA     A,Y', 'A', '!variable.parameter.symbol'],
  ['sample.sflisp', 'TFR     A,CC', 'CC', '!variable.parameter.symbol'],
  ['sample.sflisp', 'ldx     #$ff', '$ff', 'constant.numeric.hex'],
  ['sample.sflisp', "#'A'", "'A'", '!variable.parameter.symbol'],
  ['sample.sflisp', '#K + 1', '+ 1', '!variable.parameter.symbol'],
  ['sample.sflisp', 'END     Start', 'Startadresse', '!variable.parameter.symbol'],

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

  // Zahlen, deren Ziffern nicht zur Basis passen: die ganze Zahl ist ungueltig
  ['invalid-numbers.sflisp', 'ORG     0a', '0a', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '%000200100', '%000200100', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '$FG,1F', '$FG', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '$FG,1F', '1F', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '0x1F', '0x1F', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', 'LDA     #%', '%', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '$1g+1', '$1g', 'invalid.illegal.number'],
  ['invalid-numbers.sflisp', '$1g+1', '1', 'constant.numeric.decimal'],
  ['invalid-numbers.sflisp', '$0a,077', '$0a', 'constant.numeric.hex'],
  ['invalid-numbers.sflisp', '$0a,077', '077', 'constant.numeric.decimal'],
  ['invalid-numbers.sflisp', '$0a,077', '%01', 'constant.numeric.binary'],
  // nach einem Operanden ist % Modulo
  ['invalid-numbers.sflisp', '7%3,', '%', 'keyword.operator.arithmetic'],
  ['invalid-numbers.sflisp', '7%3,', '3', 'constant.numeric.decimal'],
  ['invalid-numbers.sflisp', '7%3,', '%11', 'constant.numeric.binary'],
  ['invalid-numbers.sflisp', '7%3,', '%10', 'constant.numeric.binary'],
  ['invalid-numbers.sflisp', '7%3,', 'K', 'variable.parameter.symbol'],

  // .fmem, so wie qaflisp es erzeugt
  ['qaflisp-output.fmem', 'QAflisp', 'QAflisp - FLISP Absolute crossassembler, Version 1.3', 'comment.line'],
  ['qaflisp-output.fmem', 'ClearAllMemory', '# ClearAllMemory', 'keyword.control.reset'],
  ['qaflisp-output.fmem', 'ClearAllRegisters', '# ClearAllRegisters', 'keyword.control.reset'],
  ['qaflisp-output.fmem', '20=05', '#setMemory', 'keyword.other.directive'],
  ['qaflisp-output.fmem', '20=05', '20', 'constant.numeric.address'],
  ['qaflisp-output.fmem', '20=05', '05', 'constant.numeric.hex'],
];

const files = {
  'sample.sflisp': 'source.flisp',
  'invalid-numbers.sflisp': 'source.flisp',
  'qaflisp-output.fmem': 'source.fmem',
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
