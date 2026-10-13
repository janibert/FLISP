// Symbol analysis of a FLISP source file, without the VS Code API (unit-testable).
// Follows qaflisp 1.3 (see CONTRIBUTING.md):
//   - line = [Label] Mnemonic [Operand] [Comment]; column 1 is always a label
//   - symbols are case-sensitive; register names are reserved (case-insensitive)
//   - the operand ends at the first blank outside a string; the rest is a comment
//   - nothing after END is assembled

const { isMnemonic, isInherent, takesOperand, isRegister } = require('./mnemonics');
const { checkOperand, checkImmediateMarker, modeOf } = require('./addressing');
const { INSTRUCTIONS } = require('./instructions');
const { tokenize, parse, constantValues, RESERVED } = require('./expression');

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

// Numbers whose digits do not fit their base (qaflisp: "Illegal decimal/binary/hexadecimal
// digit"). A number runs to the end of the word, as in qaflisp: "0a", "%0102", "$FG", "$".
const BASES = {
  $: { name: 'hexadecimal', digits: /^[0-9A-Fa-f]+$/, uses: '0–9 and A–F', example: '$1F' },
  '%': { name: 'binary', digits: /^[01]+$/, uses: '0 and 1', example: '%0101' },
};

function numberProblem(word) {
  const base = BASES[word[0]];
  if (base) {
    const digits = word.slice(1);
    if (!digits) return `Illegal ${base.name} digit: '${word}' without digits — write e.g. ${base.example}`;
    if (base.digits.test(digits)) return undefined;
    return `Illegal ${base.name} digit in '${word}' — ${base.name} numbers use only ${base.uses}`;
  }
  if (/^[0-9]+$/.test(word)) return undefined;
  const hex = /^0x([0-9A-Fa-f]+)$/i.exec(word) || (/^[0-9A-Fa-f]+$/.test(word) && [word, word]);
  const hint = hex ? `; for hex write $${hex[1].toUpperCase()}` : '';
  return `Illegal decimal digit in '${word}' — decimal numbers use only 0–9${hint}`;
}

function numberProblems(operand, at) {
  const found = [];
  for (const t of tokenize(operand.text)) {
    const message = t.type === 'number' && numberProblem(t.text);
    if (message) found.push(at({ start: operand.start + t.start, end: operand.start + t.end }, 'error', message));
  }
  return found;
}

// A blank inside an FCB list: the operand ends there, the rest of the line is a comment.
// Ending with ',' is an error in qaflisp ("Unterminated expression"); a comment that goes on
// with bytes (",3" or "3,4") is assembled silently without them, so it gets a warning.
const BYTE = String.raw`(?:\$[0-9A-Fa-f]+|%[01]+|[0-9]+|'.')`;
const LIST_GOES_ON = new RegExp(String.raw`^(?:,[ \t]*${BYTE}|${BYTE},${BYTE})(?:,${BYTE})*(?=[ \t;]|$)`);

function fcbListProblem(p, at) {
  if (!p.mnemonic || p.mnemonic.text.toUpperCase() !== 'FCB' || !p.operand) return undefined;
  const mn = p.mnemonic.text;
  const operand = p.operand.text;
  const comment = p.comment && !p.comment.text.startsWith(';') ? p.comment : undefined;
  if (operand.endsWith(',')) {
    // After "1,2, " the next word is most likely the missing value.
    const next = comment && /^[^ \t;]+/.exec(comment.text);
    const hint = next ? ` — the blank ends the operand; remove it: ${mn} ${operand}${next[0]}` : ' — remove the last \',\' or add a value';
    return at({ start: p.operand.end - 1, end: p.operand.end }, 'error', `Unterminated expression: the list ends with ','${hint}`);
  }
  const list = comment && LIST_GOES_ON.exec(comment.text);
  if (!list) return undefined;
  const lost = list[0].replace(/^,[ \t]*/, '');
  return at({ start: comment.start, end: comment.start + list[0].length }, 'warning',
    `Blank in the ${mn} list — the rest of the line is a comment, so ${lost} is not assembled; remove the blank: ${mn} ${operand},${lost}`);
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
  if (p.mnemonic && p.operand && isMnemonic(p.mnemonic.text)) {
    const numbers = numberProblems(p.operand, at);
    if (numbers.length) return numbers;
  }
  if (p.mnemonic && p.operand) {
    // '#' in a directive or inside an expression (qaflisp: "Illegal character", "Syntax Error").
    const hash = checkImmediateMarker(p.mnemonic.text, p.operand.text);
    if (hash) {
      const s = p.operand.start + hash.offset;
      return [at({ start: s, end: s + 1 }, 'error', hash.message)];
    }
    const fcb = fcbListProblem(p, at);
    if (fcb) return [fcb];
  }
  if (p.mnemonic) {
    // Addressing mode / operand of an instruction (qaflisp: "Illegal Addressing Mode",
    // "Illegal register combination", "Syntax Error").
    const problem = checkOperand(p.mnemonic.text, p.operand ? p.operand.text : undefined);
    if (problem) return [at(p.operand || p.mnemonic, 'error', problem.message)];
  }
  return [];
}

// Expressions in an operand: syntax (qaflisp: "Missing Parenthesis", "Operand expected",
// "Unterminated expression", "Missing operator", "Illegal use of reserved word", "Integer divide
// by zero", ...) and values that do not fit in a byte, as far as they are known without
// assembling (numbers, expressions, EQU constants; labels are skipped). qaflisp accepts
// -256..255 and reports "Value (0x...) is truncated" otherwise, but writes the low byte anyway;
// ORG beyond $FF and a negative ORG are used silently with their low byte.
const hex = (v) => `$${(v >>> 0).toString(16).toUpperCase()}`;
const show = (v) => (v < 0 ? String(v) : `${v} (${hex(v)})`);
const lowByte = (v) => `$${(v & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`;

// Items of an FCB list with their offsets. Every comma splits, as in qaflisp ("(1,2)" is an error).
function listItems(text) {
  const items = [];
  let start = 0;
  for (const t of tokenize(text)) {
    if (t.type === 'other' && t.text === ',') {
      items.push({ text: text.slice(start, t.start), start, kind: 'Value' });
      start = t.end;
    }
  }
  items.push({ text: text.slice(start), start, kind: 'Value' });
  return items;
}

// The parts of an operand that are expressions, with their offsets and what their value is.
function expressionParts(mn, operand) {
  if (mn === 'FCB') return listItems(operand);
  if (mn === 'ORG' || mn === 'EQU' || mn === 'RMB') return [{ text: operand, start: 0, kind: mn }];
  if (!INSTRUCTIONS[mn]) return []; // FCS, END
  const { mode } = modeOf(mn, operand);
  if (mode === 'imm') return [{ text: operand.slice(1), start: 1, kind: 'Value' }];
  if (mode === 'abs' || mode === 'rel') return [{ text: operand, start: 0, kind: mode === 'abs' ? 'Address' : 'Target' }];
  if (mode === 'nx' || mode === 'ny' || mode === 'nsp') return [{ text: operand.slice(0, operand.lastIndexOf(',')), start: 0, kind: 'Offset' }];
  return [];
}

function valueProblems(p, line, valueOf) {
  const mn = p.mnemonic.text.toUpperCase();
  const at = (start, end, severity, message) => ({ line, start: p.operand.start + start, end: p.operand.start + end, severity, message });
  // A syntax problem is the only message of the line; values out of range are all reported.
  const out = [];
  for (const part of expressionParts(mn, p.operand.text)) {
    if (mn === 'FCB' && part.text === '') {
      const comma = part.start > 0 ? part.start - 1 : part.start; // ",1" or "1,,2"
      return [at(comma, comma + 1, 'error', 'Unterminated expression: a value is missing in the FCB list (two commas, or a comma at the start)')];
    }
    const { value: v, problem } = parse(part.text, valueOf);
    if (problem) {
      const end = Math.max(problem.end, problem.start + 1); // a missing value at the end: mark one character
      const start = Math.min(problem.start, Math.max(0, part.text.length - 1));
      return [at(part.start + start, part.start + Math.min(end, Math.max(part.text.length, 1)), problem.severity, problem.message)];
    }
    if (v === undefined) continue;
    const whole = (severity, message) => out.push(at(part.start, part.start + part.text.length, severity, message));
    if (part.kind === 'ORG' && (v < 0 || v > 255)) whole('warning', `ORG ${show(v)} is outside the memory ($00–$FF) — qaflisp silently uses ${lowByte(v)}`);
    if (part.kind === 'RMB' && v < 0) whole('error', `Undetermined size for reservation of storage — RMB ${v}: the number of bytes cannot be negative`);
    if (['Value', 'Address', 'Offset'].includes(part.kind) && (v < -256 || v > 255)) {
      whole('error', `${part.kind} ${show(v)} does not fit in a byte (−256…255) — qaflisp reports "Value is truncated" and writes only ${lowByte(v)}`);
    }
  }
  return out;
}

function analyze(source) {
  const lines = source.split(/\r?\n/);
  const definitions = [];
  const references = [];
  const lineDiagnostics = [];
  const valueLines = []; // lines without other problems, checked for values once all EQUs are known

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const p = parseLine(text);
    const mnemonic = p.mnemonic ? p.mnemonic.text : undefined;
    const problems = lineProblems(p, line);
    lineDiagnostics.push(...problems);
    if (!problems.length && p.operand && isMnemonic(mnemonic)) valueLines.push({ p, line });
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
  const valueOf = constantValues(definitions);
  for (const { p, line } of valueLines) lineDiagnostics.push(...valueProblems(p, line, valueOf));

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
