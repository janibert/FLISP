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
const { computeLayout, expressionParts } = require('./layout');

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
    if (message) found.push(at({ start: operand.start + t.start, end: operand.start + t.end }, 'error', 'number', message));
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
    return at({ start: p.operand.end - 1, end: p.operand.end }, 'error', 'fcbTrailingComma', `Unterminated expression: the list ends with ','${hint}`);
  }
  const list = comment && LIST_GOES_ON.exec(comment.text);
  if (!list) return undefined;
  const lost = list[0].replace(/^,[ \t]*/, '');
  return at({ start: comment.start, end: comment.start + list[0].length }, 'warning', 'fcbBlank',
    `Blank in the ${mn} list — the rest of the line is a comment, so ${lost} is not assembled; remove the blank: ${mn} ${operand},${lost}`);
}

const OPERAND_KIND = { missing: 'missingOperand', bad: 'badOperand', mode: 'addressingMode', pair: 'registerPair' };

// Problems of the line structure that qaflisp reports as "Illegal mnemonic" / "Illegal label".
function lineProblems(p, line) {
  const at = (s, severity, kind, message) => ({ line, start: s.start, end: s.end, severity, kind, message });
  if (p.invalidLabel && p.invalidLabel.reason === 'mnemonic') {
    return [at(p.invalidLabel, 'error', 'mnemonicInColumn1',
      `Illegal mnemonic: '${p.invalidLabel.name}' in column 1 is read as a label — indent instructions`)];
  }
  if (p.mnemonicAsLabel) {
    return [at(p.label, 'warning', 'mnemonicAsLabel',
      `'${p.label.name}' in column 1 is read as a label, so this line generates no code — indent it if it is meant as an instruction`)];
  }
  if (p.invalidLabel) {
    return [at(p.invalidLabel, 'error', 'illegalLabel', 'Illegal label — a label must start with a letter or \'_\'')];
  }
  if (p.mnemonic && !isMnemonic(p.mnemonic.text)) {
    const word = p.mnemonic.text;
    // An indented label: an identifier followed by a real mnemonic, or standing alone.
    const looksLikeLabel = /^[A-Za-z_][A-Za-z0-9_]*:?$/.test(word) && (!p.next || isMnemonic(p.next));
    const hint = looksLikeLabel ? ` — if '${word.replace(/:$/, '')}' is a label, it must start in column 1` : '';
    return [at(p.mnemonic, 'error', 'illegalMnemonic', `Illegal mnemonic '${word}'${hint}`)];
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
      return [at({ start: s, end: s + 1 }, 'error', 'immediateMarker', hash.message)];
    }
    const fcb = fcbListProblem(p, at);
    if (fcb) return [fcb];
  }
  if (p.mnemonic) {
    // Addressing mode / operand of an instruction (qaflisp: "Illegal Addressing Mode",
    // "Illegal register combination", "Syntax Error").
    const problem = checkOperand(p.mnemonic.text, p.operand ? p.operand.text : undefined);
    if (problem) return [at(p.operand || p.mnemonic, 'error', OPERAND_KIND[problem.kind], problem.message)];
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

// ORG and RMB are evaluated in qaflisp's first pass, where not every value is known yet
// (measured, see CONTRIBUTING.md "Where expressions can be used"):
//   a label further down                      ORG: "Forward reference"; RMB: "Phase error between
//                                             passes" at a later label, or "Undetermined size"
//   a constant (EQU) further down             ORG: "Forward reference"; RMB: fine
//   a constant that depends on a label, or    "Phase error" / "Undetermined size": qaflisp uses
//   on a symbol defined after it              labels in EQU as 0 in the first pass
// Labels above, used directly (ORG Start+4, RMB End1-Start), are fine.
function passOneProblem(part, line, firstDef) {
  if (part.kind !== 'ORG' && part.kind !== 'RMB') return undefined;
  const mn = part.kind;
  // Why a constant is not known in pass 1: { label } or { later, user }, through other constants.
  const constantIssue = (d, seen) => {
    if (d.operand === undefined || seen.has(d.name)) return undefined;
    seen.add(d.name);
    for (const t of tokenize(d.operand)) {
      const s = t.type === 'symbol' && firstDef.get(t.text);
      if (!s) continue;
      if (s.kind !== 'constant') return { label: s };
      if (s.line > d.line) return { later: s, user: d };
      const deeper = constantIssue(s, seen);
      if (deeper) return deeper;
    }
    return undefined;
  };
  for (const t of tokenize(part.text)) {
    const d = t.type === 'symbol' && firstDef.get(t.text);
    if (!d) continue;
    const at = (message) => ({ start: t.start, end: t.end, message });
    if (d.line > line && (mn === 'ORG' || d.kind !== 'constant')) {
      return mn === 'ORG'
        ? at(`Forward reference: '${t.text}' is defined further down (line ${d.line + 1}) — ORG can only use symbols defined above it`)
        : at(`RMB depends on label '${t.text}', which is defined further down (line ${d.line + 1}) — qaflisp cannot know the size in its first pass ("Phase error between passes" or "Undetermined size")`);
    }
    if (d.kind !== 'constant') continue;
    const issue = constantIssue(d, new Set());
    if (issue && issue.label) {
      return at(`${mn} uses '${t.text}', which depends on the label '${issue.label.name}' — qaflisp uses labels in EQU as 0 in its first pass ("Phase error between passes" or "Undetermined size"); write the label directly in the ${mn}`);
    }
    if (issue) {
      return at(`${mn} uses '${t.text}', but '${issue.user.name}' uses '${issue.later.name}', which is defined further down (line ${issue.later.line + 1}) — qaflisp does not know the value in its first pass ("Phase error between passes"); define '${issue.later.name}' first`);
    }
  }
  return undefined;
}

function valueProblems(p, line, valueOf, firstDef, layout) {
  const mn = p.mnemonic.text.toUpperCase();
  const at = (start, end, severity, kind, message) => ({ line, start: p.operand.start + start, end: p.operand.start + end, severity, kind, message });
  if (mn === 'FCS') {
    // qaflisp: "Bad operand syntax"; it writes 2 bytes for "" and adds a newline byte to an open string
    const o = p.operand.text;
    if (o === '""') return [at(0, 2, 'error', 'emptyString', 'Bad operand syntax: empty string — FCS needs at least one character (qaflisp still writes 2 bytes)')];
    let i = 1;
    while (i < o.length && o[i] !== '"') i += o[i] === '\\' ? 2 : 1;
    if (o.startsWith('"') && i >= o.length) return [at(0, o.length, 'error', 'unterminatedString', 'Bad operand syntax: the string has no closing \'"\' (qaflisp adds a newline byte)')];
    return [];
  }
  // A syntax problem is the only message of the line; values out of range are all reported.
  const out = [];
  for (const part of expressionParts(mn, p.operand.text)) {
    if (mn === 'FCB' && part.text === '') {
      const comma = part.start > 0 ? part.start - 1 : part.start; // ",1" or "1,,2"
      return [at(comma, comma + 1, 'error', 'fcbMissingValue', 'Unterminated expression: a value is missing in the FCB list (two commas, or a comma at the start)')];
    }
    const { value: v, problem } = parse(part.text, valueOf);
    if (problem) {
      const end = Math.max(problem.end, problem.start + 1); // a missing value at the end: mark one character
      const start = Math.min(problem.start, Math.max(0, part.text.length - 1));
      let { kind, message } = problem;
      // FCB (1,2): the comma splits the list even inside parentheses - say so instead of only "not closed"
      const rest = p.operand.text.slice(part.start + part.text.length);
      if (mn === 'FCB' && kind === 'unclosedParen' && rest.startsWith(',')) {
        kind = 'fcbCommaInParens';
        const whole = /^\((.*)\)$/.exec(p.operand.text);
        message = `Missing Parenthesis: in FCB every comma separates two values, also inside parentheses — '${part.text.trim()}' is not closed` +
          (whole ? `; for a list of bytes write FCB ${whole[1]}` : '');
      }
      return [at(part.start + start, part.start + Math.min(end, Math.max(part.text.length, 1)), problem.severity, kind, message)];
    }
    const forward = passOneProblem(part, line, firstDef);
    if (forward) return [{ ...at(part.start + forward.start, part.start + forward.end, 'error', 'pass1', forward.message), mnemonic: mn }];
    if (v === undefined) continue;
    const whole = (severity, kind, message) => out.push(at(part.start, part.start + part.text.length, severity, kind, message));
    if (part.kind === 'ORG' && (v < 0 || v > 255)) whole('warning', 'orgOutsideMemory', `ORG ${show(v)} is outside the memory ($00–$FF) — qaflisp silently uses ${lowByte(v)}`);
    if (part.kind === 'RMB' && v <= 0) whole('error', 'rmbSize', `Undetermined size for reservation of storage — RMB ${v}: the number of bytes must be at least 1`);
    if (['Value', 'Address', 'Offset'].includes(part.kind) && (v < -256 || v > 255)) {
      whole('error', 'byteRange', `${part.kind} ${show(v)} does not fit in a byte (−256…255) — qaflisp reports "Value is truncated" and writes only ${lowByte(v)}`);
    }
    // Branch: displacement from the next instruction, -128..127 (qaflisp: "Displacement (0x...) is out of range")
    const here = part.kind === 'Target' && layout && layout.lines.get(line);
    if (here && here.size > 0) {
      const displacement = v - (here.address + here.size);
      if (displacement < -128 || displacement > 127) {
        const far = displacement < 0 ? `${-displacement} bytes back` : `${displacement} bytes ahead`;
        const instead = mn === 'BSR' ? 'JSR' : 'JMP (with the opposite branch around it for a conditional branch)';
        whole('error', 'branchRange', `Branch target ${show(v)} is ${far} — a branch reaches only −128…+127 bytes from the next instruction ` +
          `(qaflisp: "Displacement is out of range"); use ${instead}`);
      }
    }
  }
  return out;
}

// An instruction without operand (PSHA, NOP, ASLA ...) followed by something that looks like an
// operand: qaflisp silently treats it as a comment ("ASLA Data" shifts A, not Data). Plain words
// ("RTS back to caller") are comments and stay unflagged.
function ignoredOperand(p, firstDef) {
  if (!p.comment || !p.mnemonic) return undefined;
  const mn = p.mnemonic.text.toUpperCase();
  const d = INSTRUCTIONS[mn];
  if (!d || !d.variants.every((v) => v.mode === 'inh')) return undefined;
  const word = /^[^ \t;]+/.exec(p.comment.text)[0];
  const lead = /^[A-Za-z_][A-Za-z0-9_]*/.exec(word);
  const looksLikeOperand = /^[#$%'(,0-9~!-]/.test(word)
    || /,(X|Y|SP|[+-]?[XY][+-]?)$/i.test(word)
    || Boolean(lead && firstDef.has(lead[0]) && (lead[0] === word || /^[+\-*/%&|^<>,]/.test(word.slice(lead[0].length))));
  if (!looksLikeOperand) return undefined;
  // ASLA Data -> ASL Data, if that form exists and accepts the operand
  const base = mn.endsWith('A') && INSTRUCTIONS[mn.slice(0, -1)] && !checkOperand(mn.slice(0, -1), word)
    ? mn.slice(0, -1) : undefined;
  const hint = base ? `; to work on memory write ${base} ${word}` : `; remove it, or put a comment after ';'`;
  return { start: p.comment.start, end: p.comment.start + word.length,
    message: `${mn} has no operand — qaflisp silently treats '${word}' as a comment${hint}` };
}

function analyze(source) {
  const lines = source.split(/\r?\n/);
  const definitions = [];
  const references = [];
  const lineDiagnostics = [];
  const valueLines = []; // lines without other problems, checked for values once all EQUs are known
  const records = []; // all lines up to END, for the address layout

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const p = parseLine(text);
    const mnemonic = p.mnemonic ? p.mnemonic.text : undefined;
    const problems = lineProblems(p, line);
    lineDiagnostics.push(...problems);
    records.push({ line, p });
    if (!problems.length && p.operand && isMnemonic(mnemonic)) valueLines.push({ p, line });
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
    if (p.operand && !malformed) {
      for (const s of operandSymbols(p.operand)) references.push({ ...s, line });
    }
    if (mnemonic && mnemonic.toUpperCase() === 'END') break; // qaflisp stops here
  }
  const firstDef = new Map();
  const twice = new Set();
  for (const d of definitions) {
    if (firstDef.has(d.name)) twice.add(d.name);
    else firstDef.set(d.name, d);
  }
  // Addresses (src/layout.js), then values with labels: FCB Start+300, branch targets, ...
  const unknownInPassOne = new Set(records
    .filter(({ p }) => p.operand && p.mnemonic && ['ORG', 'RMB'].includes(p.mnemonic.text.toUpperCase()))
    .filter(({ p, line }) => expressionParts(p.mnemonic.text.toUpperCase(), p.operand.text).some((part) => passOneProblem(part, line, firstDef)))
    .map(({ line }) => line));
  const layout = computeLayout(records, twice, constantValues(definitions), unknownInPassOne);
  const valueOf = constantValues(definitions, (name) => layout.labels.get(name));
  for (const { p, line } of valueLines) lineDiagnostics.push(...valueProblems(p, line, valueOf, firstDef, layout));
  for (const { p, line } of records) {
    const w = ignoredOperand(p, firstDef);
    if (w) lineDiagnostics.push({ line, start: w.start, end: w.end, severity: 'warning', kind: 'ignoredOperand', message: w.message });
  }
  if (layout.beyond !== undefined) {
    const { p, line } = records.find((r) => r.line === layout.beyond);
    const where = p.mnemonic || p.label;
    const start = layout.lines.get(line).address;
    const address = start < 0 ? start : Math.max(start, 0x100); // the first byte beyond $FF
    lineDiagnostics.push({ line, start: where.start, end: where.end, severity: 'warning', kind: 'beyondMemory',
      message: `From here on, code or data lies beyond $FF (${address < 0 ? address : hex(address)}…) — the memory has only 256 bytes; ` +
        `qaflisp silently wraps around to $00 and overwrites what is there` });
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
        diagnostics.push({ line: d.line, start: d.start, end: d.end, severity: 'warning', kind: 'registerName',
          message: `'${name}' is a register name and cannot be used as a symbol` });
      }
    }
    if (defs.length > 1) {
      for (const d of defs) {
        const others = defs.filter((o) => o !== d).map((o) => o.line + 1).join(', ');
        diagnostics.push({ line: d.line, start: d.start, end: d.end, severity: 'error', kind: 'multipleDefinition',
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
    diagnostics.push({ line: r.line, start: r.start, end: r.end, severity: 'error', kind: 'undefinedSymbol',
      message: `Undefined symbol '${r.name}'${hint}` });
  }

  return { definitions, references, byName, diagnostics, layout, valueOf };
}

// A value for the hover: `$FC` = 252 = `%11111100`; negative values with their byte.
function describeValue(v) {
  if (v >= 0 && v <= 255) return `\`$${v.toString(16).toUpperCase().padStart(2, '0')}\` = ${v} = \`%${v.toString(2).padStart(8, '0')}\``;
  if (v < 0 && v >= -256) return `${v} (byte \`${lowByte(v)}\`)`;
  return `\`${hex(v)}\` = ${v} — does not fit in a byte`;
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
      relatedText: `'${cause.name}' defined more than once`,
    };
  }
  // Second known cause: an ORG or RMB with a value qaflisp does not know in pass 1.
  const pass1 = analysis.diagnostics.filter((d) => d.line < line && d.kind === 'pass1').pop();
  if (pass1) {
    const mn = pass1.mnemonic;
    const effect = mn === 'ORG' ? 'sets a different address' : 'reserves a different number of bytes';
    return {
      message: `${what} Cause: the ${mn} in line ${pass1.line + 1} uses a value that qaflisp does not know in pass 1, ` +
        `so it ${effect} in pass 1 and pass 2. Use numbers, EQU constants with numbers, or labels above the ${mn} directly.`,
      relatedLine: pass1.line,
      relatedName: mn,
      relatedText: `${mn} with a value qaflisp does not know in pass 1`,
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

module.exports = { analyze, parseLine, operandSymbols, symbolAt, checkNewName, explainPhaseError, kindOf, describeValue };
