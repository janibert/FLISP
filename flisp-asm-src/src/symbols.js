// Symbol analysis of a FLISP source file, without the VS Code API (unit-testable).
// Follows qaflisp 1.3 (see CONTRIBUTING.md):
//   - line = [Label] Mnemonic [Operand] [Comment]; column 1 is always a label
//   - symbols are case-sensitive; register names are reserved (case-insensitive)
//   - the operand ends at the first blank outside a string; the rest is a comment
//   - nothing after END is assembled

const { isMnemonic, isInherent, takesOperand, isRegister } = require('./mnemonics');
const { checkOperand } = require('./addressing');
const { tokenize, skipQuoted, constantValues, RESERVED } = require('./expression');
const { computeLayout } = require('./layout');
const { checkSource, unknownInPassOne } = require('./checks');

// A label in column 1: qaflisp also accepts "$" and "." after the first character (A$b, x.y).
const IDENT = /[A-Za-z_][A-Za-z0-9_$.]*/y;

// Kind of a definition, from the mnemonic on its line.
function kindOf(mnemonic) {
  const m = (mnemonic || '').toUpperCase();
  if (m === 'EQU') return 'constant';
  if (m === 'FCB' || m === 'FCS' || m === 'RMB') return 'data';
  return 'code';
}

// Splits one line into label, mnemonic and operand (with column positions).
function parseLine(text) {
  const result = {};
  if (/^[ \t]*(;|$)/.test(text)) return result; // empty or comment line

  let i = 0;
  if (/[A-Za-z_]/.test(text[0])) {
    IDENT.lastIndex = 0;
    const name = IDENT.exec(text)[0];
    if (isMnemonic(name)) {
      // qaflisp reads a mnemonic in column 1 as a label. Followed by a mnemonic it is one
      // ("Neg EQU 3", "End NOP"); followed by anything else the line fails ("LDA #1":
      // Illegal mnemonic); alone it is a label without code ("NOP" - usually a missing indent).
      const next = /^:?[ \t]+([^ \t;]+)/.exec(text.slice(name.length));
      if (next && !isMnemonic(next[1])) return { invalidLabel: { name, start: 0, end: name.length, reason: 'mnemonic' } };
      if (!next) result.mnemonicAsLabel = true;
    }
    result.label = { name, start: 0, end: name.length };
    i = name.length;
    if (text[i] === ':') i++;
  } else if (!/[ \t]/.test(text[0])) {
    // e.g. a digit or '*' in column 1: "Illegal label"
    const end = text.search(/[ \t]|$/);
    return { invalidLabel: { name: text.slice(0, end), start: 0, end, reason: 'character' } };
  }

  while (i < text.length && /[ \t]/.test(text[i])) i++;
  if (i >= text.length || text[i] === ';') return result;

  const mStart = i;
  while (i < text.length && !/[ \t]/.test(text[i])) i++;
  result.mnemonic = { text: text.slice(mStart, i), start: mStart, end: i };
  if (!isMnemonic(result.mnemonic.text)) {
    // Unknown mnemonic: remember the next word, to recognise an indented label.
    const next = /^[ \t]+([^ \t;]+)/.exec(text.slice(i));
    if (next) result.next = next[1];
    return result;
  }
  if (!takesOperand(result.mnemonic.text) || isInherent(result.mnemonic.text)) {
    // No operand: qaflisp reads the rest of the line as a comment (also "ASLA Data").
    while (i < text.length && /[ \t]/.test(text[i])) i++;
    if (i < text.length && text[i] !== ';') result.comment = { text: text.slice(i), start: i };
    return result;
  }

  while (i < text.length && /[ \t]/.test(text[i])) i++;
  if (i >= text.length || text[i] === ';') return result;

  // The operand ends at the first blank outside a string or character constant.
  const oStart = i;
  while (i < text.length && !/[ \t]/.test(text[i])) i = skipQuoted(text, i);
  result.operand = { text: text.slice(oStart, i), start: oStart, end: i };
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  if (i < text.length) result.comment = { text: text.slice(i), start: i };
  return result;
}

// Symbol names used in an operand (strings, character constants, numbers and registers skipped).
function operandSymbols(operand) {
  return tokenize(operand.text)
    .filter((t) => t.type === 'symbol' && !RESERVED.has(t.text.toUpperCase())) // PC is an ordinary symbol here
    .map((t) => ({ name: t.text, start: operand.start + t.start, end: operand.start + t.end }));
}

// encoding: 'utf8' (VS Code's default) or 'singleByte' (cp1252 and similar) - the encoding of the
// file qaflisp reads; it decides the size of non-ASCII characters in strings.
function analyze(source, { encoding = 'utf8' } = {}) {
  const lines = source.split(/\r\n|\r|\n/); // the line breaks of VS Code
  const definitions = [];
  const references = [];
  const records = []; // all lines up to END, for the checks and the address layout

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const p = parseLine(text);
    const mnemonic = p.mnemonic ? p.mnemonic.text : undefined;
    records.push({ line, p });
    if (p.label) {
      definitions.push({
        name: p.label.name, line, start: p.label.start, end: p.label.end,
        kind: kindOf(mnemonic), mnemonic, operand: p.operand ? p.operand.text : undefined, text,
      });
    } else if (p.invalidLabel && p.invalidLabel.reason === 'mnemonic') {
      // "LDA #1" in column 1: qaflisp still defines the label LDA (then fails on "#1"), so a
      // second "LDA ..." in column 1 is a multiple definition there too.
      const l = p.invalidLabel;
      definitions.push({ name: l.name, line, start: l.start, end: l.end, kind: 'code', mnemonic: undefined, operand: undefined, text });
    }
    // A malformed operand (e.g. ",Z+") is reported as such; its words are not symbol uses.
    const malformed = p.operand && (checkOperand(mnemonic, p.operand.text) || {}).kind === 'bad';
    // FCS takes only a string; qaflisp ignores what follows it ("ab"cd), so it uses no symbols.
    const fcs = mnemonic && mnemonic.toUpperCase() === 'FCS';
    if (p.operand && !malformed && !fcs) {
      const atEnd = mnemonic.toUpperCase() === 'END';
      for (const s of operandSymbols(p.operand)) references.push(atEnd ? { ...s, line, atEnd } : { ...s, line });
    }
    if (mnemonic && mnemonic.toUpperCase() === 'END') break; // qaflisp stops here
  }
  const firstDef = new Map();
  const twice = new Set();
  const byName = new Map();
  for (const d of definitions) {
    if (firstDef.has(d.name)) twice.add(d.name);
    else firstDef.set(d.name, d);
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }
  // Addresses (src/layout.js), then values with labels: FCB Start+300, branch targets, ...
  const layout = computeLayout(records, twice, constantValues(definitions), unknownInPassOne(records, firstDef), encoding);
  const valueOf = constantValues(definitions, (name) => layout.labels.get(name));
  const diagnostics = checkSource({ records, references, byName, firstDef, layout, valueOf, encoding });
  return { definitions, references, byName, diagnostics, layout, valueOf };
}

// The symbol (definition or reference) at a position, if any.
function symbolAt(analysis, line, character) {
  const hit = (s) => s.line === line && character >= s.start && character <= s.end;
  const def = analysis.definitions.find(hit);
  if (def) return { name: def.name, start: def.start, end: def.end, isDefinition: true };
  const ref = analysis.references.find(hit);
  if (ref) return { name: ref.name, start: ref.start, end: ref.end, isDefinition: false };
  return undefined;
}

// Checks a new name for a rename; returns an error message or undefined.
function checkNewName(analysis, oldName, newName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return `'${newName}' is not a valid symbol name (letters, digits, '_'; not starting with a digit)`;
  if (isRegister(newName)) return `'${newName}' is a register name`;
  if (isMnemonic(newName)) return `'${newName}' is a mnemonic or directive`;
  if (newName !== oldName && analysis.byName.has(newName)) return `'${newName}' is already defined`;
  return undefined;
}

module.exports = { analyze, parseLine, operandSymbols, symbolAt, checkNewName, kindOf };
