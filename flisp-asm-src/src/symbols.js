// Symbol analysis of a FLISP source file, without the VS Code API (unit-testable).
// Follows qaflisp 1.3 (see CONTRIBUTING.md):
//   - line = [Label] Mnemonic [Operand] [Comment]; column 1 is always a label
//   - symbols are case-sensitive; register names are reserved (case-insensitive)
//   - the operand ends at the first blank outside a string; the rest is a comment
//   - nothing after END is assembled

const { isMnemonic, isInherent, takesOperand, isRegister } = require('./mnemonics');
const { checkOperand } = require('./addressing');

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

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
    // A mnemonic in column 1 is read as a label by qaflisp and fails ("Illegal mnemonic").
    if (isMnemonic(name)) return { invalidLabel: { name, start: 0, end: name.length, reason: 'mnemonic' } };
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
  if (!takesOperand(result.mnemonic.text) || isInherent(result.mnemonic.text)) return result;

  while (i < text.length && /[ \t]/.test(text[i])) i++;
  if (i >= text.length || text[i] === ';') return result;

  // The operand ends at the first blank outside a string or character constant.
  const oStart = i;
  while (i < text.length && !/[ \t]/.test(text[i])) {
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else if (text[i] === "'") {
      i += 3; // character constant 'x'
    } else {
      i++;
    }
  }
  i = Math.min(i, text.length);
  result.operand = { text: text.slice(oStart, i), start: oStart, end: i };
  return result;
}

// Symbol names used in an operand (strings, character constants, numbers and registers skipped).
function operandSymbols(operand) {
  const found = [];
  const t = operand.text;
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"') {
      i++;
      while (i < t.length && t[i] !== '"') i += t[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === "'") {
      i += 3;
    } else if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const name = IDENT.exec(t)[0];
      if (!isRegister(name)) found.push({ name, start: operand.start + i, end: operand.start + i + name.length });
      i += name.length;
    } else if (/[0-9$%]/.test(c)) {
      // a number such as 42, $FF or %0101 — its letters are not symbols
      i++;
      while (i < t.length && /[A-Za-z0-9_]/.test(t[i])) i++;
    } else {
      i++;
    }
  }
  return found;
}

// Problems of the line structure that qaflisp reports as "Illegal mnemonic" / "Illegal label".
function lineProblems(p, line) {
  const at = (s, severity, message) => ({ line, start: s.start, end: s.end, severity, message });
  if (p.invalidLabel && p.invalidLabel.reason === 'mnemonic') {
    return [at(p.invalidLabel, 'error',
      `Illegal mnemonic: '${p.invalidLabel.name}' in column 1 is read as a label — indent instructions`)];
  }
  if (p.invalidLabel) {
    return [at(p.invalidLabel, 'error', 'Illegal label — a label must start with a letter or \'_\'')];
  }
  if (p.mnemonic && !isMnemonic(p.mnemonic.text)) {
    const word = p.mnemonic.text;
    // An indented label: an identifier followed by a real mnemonic, or standing alone.
    const looksLikeLabel = /^[A-Za-z_][A-Za-z0-9_]*:?$/.test(word) && (!p.next || isMnemonic(p.next));
    const hint = looksLikeLabel ? ` — if '${word.replace(/:$/, '')}' is a label, it must start in column 1` : '';
    return [at(p.mnemonic, 'error', `Illegal mnemonic '${word}'${hint}`)];
  }
  if (p.mnemonic) {
    // Addressing mode / operand of an instruction (qaflisp: "Illegal Addressing Mode",
    // "Illegal register combination", "Syntax Error").
    const problem = checkOperand(p.mnemonic.text, p.operand ? p.operand.text : undefined);
    if (problem) return [at(p.operand || p.mnemonic, 'error', problem.message)];
  }
  return [];
}

function analyze(source) {
  const lines = source.split(/\r?\n/);
  const definitions = [];
  const references = [];
  const lineDiagnostics = [];

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const p = parseLine(text);
    const mnemonic = p.mnemonic ? p.mnemonic.text : undefined;
    lineDiagnostics.push(...lineProblems(p, line));
    if (p.label) {
      definitions.push({
        name: p.label.name, line, start: p.label.start, end: p.label.end,
        kind: kindOf(mnemonic), mnemonic, operand: p.operand ? p.operand.text : undefined, text,
      });
    }
    // A malformed operand (e.g. ",Z+") is reported as such; its words are not symbol uses.
    const malformed = p.operand && (checkOperand(mnemonic, p.operand.text) || {}).kind === 'bad';
    if (p.operand && !malformed) {
      for (const s of operandSymbols(p.operand)) references.push({ ...s, line });
    }
    if (mnemonic && mnemonic.toUpperCase() === 'END') break; // qaflisp stops here
  }

  const byName = new Map();
  for (const d of definitions) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }

  const diagnostics = [...lineDiagnostics];
  for (const [name, defs] of byName) {
    if (isRegister(name)) {
      for (const d of defs) {
        diagnostics.push({ line: d.line, start: d.start, end: d.end, severity: 'warning',
          message: `'${name}' is a register name and cannot be used as a symbol` });
      }
    }
    if (defs.length > 1) {
      for (const d of defs) {
        const others = defs.filter((o) => o !== d).map((o) => o.line + 1).join(', ');
        diagnostics.push({ line: d.line, start: d.start, end: d.end, severity: 'error',
          message: `Multiple definition of '${name}' (also in line ${others})` });
      }
    }
  }
  const lowerNames = new Map();
  for (const name of byName.keys()) {
    const k = name.toLowerCase();
    if (!lowerNames.has(k)) lowerNames.set(k, []);
    lowerNames.get(k).push(name);
  }
  for (const r of references) {
    if (byName.has(r.name)) continue;
    const similar = lowerNames.get(r.name.toLowerCase());
    const hint = similar ? ` — did you mean '${similar[0]}'? Symbols are case-sensitive.` : '';
    diagnostics.push({ line: r.line, start: r.start, end: r.end, severity: 'error',
      message: `Undefined symbol '${r.name}'${hint}` });
  }

  return { definitions, references, byName, diagnostics };
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

// qaflisp's "Phase error between passes" names neither the cause nor the line of the cause.
// qaflisp does not assemble a line whose label is defined more than once, so the addresses
// after it shift and the next label lands somewhere else in pass 2. Returns an explanation
// and the line (0-based) of the nearest multiple definition above, if there is one.
function explainPhaseError(analysis, line) {
  let cause;
  for (const defs of analysis.byName.values()) {
    if (defs.length < 2) continue;
    for (const d of defs) if (d.line < line && (!cause || d.line > cause.line)) cause = d;
  }
  const what = 'the address of this label differs between pass 1 and pass 2.';
  if (cause) {
    return {
      message: `${what} Follow-up error: '${cause.name}' is defined more than once (line ${cause.line + 1}); ` +
        'qaflisp does not assemble such a line, so the following addresses shift. Fix the multiple definition.',
      relatedLine: cause.line,
      relatedName: cause.name,
    };
  }
  return {
    message: `${what} Possible cause: an EQU that uses a symbol defined further down ` +
      '(see the warning "forward referenced") and is used as a size, e.g. in RMB.',
  };
}

// Checks a new name for a rename; returns an error message or undefined.
function checkNewName(analysis, oldName, newName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return `'${newName}' is not a valid symbol name (letters, digits, '_'; not starting with a digit)`;
  if (isRegister(newName)) return `'${newName}' is a register name`;
  if (isMnemonic(newName)) return `'${newName}' is a mnemonic or directive`;
  if (newName !== oldName && analysis.byName.has(newName)) return `'${newName}' is already defined`;
  return undefined;
}

module.exports = { analyze, parseLine, operandSymbols, symbolAt, checkNewName, explainPhaseError, kindOf };
