// The live checks of a FLISP source, without the VS Code API (unit-testable). Every message
// follows what qaflisp 1.3 reports (see CONTRIBUTING.md) and has a stable kind; code branches
// on the kind, never on the message. The order of the checks is in checkSource().

const { isMnemonic, isRegister } = require('./mnemonics');
const { checkOperand, checkImmediateMarker } = require('./addressing');
const { INSTRUCTIONS } = require('./instructions');
const { tokenize, parse } = require('./expression');
const { expressionParts } = require('./layout');

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

// Directives without their label or operand. qaflisp ignores such a line (no bytes, ORG keeps
// the address) and reports it as below; "No label" comes first.
const DIRECTIVE_EXAMPLE = { ORG: 'ORG $20', RMB: 'RMB 4', FCB: 'FCB 1,2,3', EQU: 'K EQU 5' };

function directiveProblem(p, at) {
  const mn = p.mnemonic.text.toUpperCase();
  if (mn === 'EQU' && !p.label) {
    return at(p.mnemonic, 'error', 'equWithoutLabel', 'No label for "EQU" — the name of the constant must stand in column 1, e.g. K EQU 5');
  }
  if (p.operand) return undefined;
  if (mn === 'FCS') return at(p.mnemonic, 'error', 'missingOperand', 'Bad operand syntax — FCS needs a string, e.g. FCS "TEXT"');
  if (DIRECTIVE_EXAMPLE[mn]) {
    return at(p.mnemonic, 'error', 'missingOperand', `Unterminated expression — ${mn} needs a value, e.g. ${DIRECTIVE_EXAMPLE[mn]}`);
  }
  return undefined;
}

const OPERAND_KIND ={ missing: 'missingOperand', bad: 'badOperand', mode: 'addressingMode', pair: 'registerPair' };

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
    const directive = directiveProblem(p, at);
    if (directive) return [directive];
    // Addressing mode / operand of an instruction (qaflisp: "Illegal Addressing Mode",
    // "Illegal register combination", "Syntax Error").
    const problem = checkOperand(p.mnemonic.text, p.operand ? p.operand.text : undefined);
    if (problem) return [at(p.operand || p.mnemonic, 'error', OPERAND_KIND[problem.kind], problem.message)];
  }
  return [];
}

// Numbers in messages and in the hover.
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

// Expressions in an operand: syntax (qaflisp: "Missing Parenthesis", "Operand expected",
// "Unterminated expression", "Missing operator", "Illegal use of reserved word", "Integer divide
// by zero", ...) and values that do not fit in a byte, as far as they are known without
// assembling (numbers, expressions, EQU constants; labels are skipped). qaflisp accepts
// -256..255 and reports "Value (0x...) is truncated" otherwise, but writes the low byte anyway;
// ORG beyond $FF and a negative ORG are used silently with their low byte.
function valueProblems(p, line, valueOf, firstDef, layout) {
  const mn = p.mnemonic.text.toUpperCase();
  const at = (start, end, severity, kind, message) => ({ line, start: p.operand.start + start, end: p.operand.start + end, severity, kind, message });
  if (mn === 'FCS') {
    // qaflisp: "Bad operand syntax"; it adds a newline byte to an open string. "" is no empty
    // string for qaflisp: the second '"' is the first character and the string goes on (scanString).
    const o = p.operand.text;
    const [string] = tokenize(o);
    if (string.type === 'string' && !string.closed && o.startsWith('""')) {
      return [at(0, o.length, 'error', 'emptyString', 'Bad operand syntax: empty string — FCS needs at least one character; qaflisp takes the second \'"\' as a character and reads on to the end of the line')];
    }
    if (string.type !== 'string') return [at(0, o.length, 'error', 'fcsNotString', 'Bad operand syntax — FCS takes a string in double quotes, e.g. FCS "TEXT"; for single bytes use FCB')];
    if (!string.closed) return [at(0, o.length, 'error', 'unterminatedString', 'Bad operand syntax: the string has no closing \'"\' (qaflisp adds a newline byte)')];
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

// A value for the hover: `$FC` = 252 = `%11111100`; negative values with their byte.
function describeValue(v) {
  if (v >= 0 && v <= 255) return `\`$${v.toString(16).toUpperCase().padStart(2, '0')}\` = ${v} = \`%${v.toString(2).padStart(8, '0')}\``;
  if (v < 0 && v >= -256) return `${v} (byte \`${lowByte(v)}\`)`;
  return `\`${hex(v)}\` = ${v} — does not fit in a byte`;
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

// Lines (ORG, RMB) whose value qaflisp does not know in its first pass; the layout stops there.
function unknownInPassOne(records, firstDef) {
  return new Set(records
    .filter(({ p }) => p.operand && p.mnemonic && ['ORG', 'RMB'].includes(p.mnemonic.text.toUpperCase()))
    .filter(({ p, line }) => expressionParts(p.mnemonic.text.toUpperCase(), p.operand.text).some((part) => passOneProblem(part, line, firstDef)))
    .map(({ line }) => line));
}

// Symbols: register names used as labels, multiple definitions, undefined symbols.
function symbolProblems(byName, references) {
  const diagnostics = [];
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
    if (r.atEnd) {
      // qaflisp only warns, with the misleading text "start symbol 'X' is defined"
      diagnostics.push({ line: r.line, start: r.start, end: r.end, severity: 'warning', kind: 'undefinedStartSymbol',
        message: `Undefined start symbol '${r.name}'${hint || ' — END takes the label where the program starts'} (qaflisp only warns: "start symbol '${r.name}' is defined")` });
      continue;
    }
    diagnostics.push({ line: r.line, start: r.start, end: r.end, severity: 'error', kind: 'undefinedSymbol',
      message: `Undefined symbol '${r.name}'${hint}` });
  }
  return diagnostics;
}

// All live checks of a source, in this order (it decides which messages a line gets):
//   1. lineProblems: line structure, numbers, '#', FCB list, operand form - at most one per line
//   2. valueProblems, only on lines without a problem from 1: expressions, values, first pass,
//      branch range - after all EQUs and the address layout are known
//   3. ignoredOperand: an instruction without operand followed by something operand-like
//   4. the first code or data beyond $FF
//   5. symbolProblems: register names, multiple definitions, undefined symbols
// records: [{ line, p }] up to END, references, byName, firstDef: from symbols.analyze;
// layout: computeLayout; valueOf: values of constants and labels.
function checkSource({ records, references, byName, firstDef, layout, valueOf }) {
  const diagnostics = [];
  const valueLines = [];
  for (const { p, line } of records) {
    const problems = lineProblems(p, line);
    diagnostics.push(...problems);
    if (!problems.length && p.operand && isMnemonic(p.mnemonic.text)) valueLines.push({ p, line });
  }
  for (const { p, line } of valueLines) diagnostics.push(...valueProblems(p, line, valueOf, firstDef, layout));
  for (const { p, line } of records) {
    const w = ignoredOperand(p, firstDef);
    if (w) diagnostics.push({ line, start: w.start, end: w.end, severity: 'warning', kind: 'ignoredOperand', message: w.message });
  }
  if (layout.beyond !== undefined) {
    const { p, line } = records.find((r) => r.line === layout.beyond);
    const where = p.mnemonic || p.label;
    const start = layout.lines.get(line).address;
    const address = start < 0 ? start : Math.max(start, 0x100); // the first byte beyond $FF
    diagnostics.push({ line, start: where.start, end: where.end, severity: 'warning', kind: 'beyondMemory',
      message: `From here on, code or data lies beyond $FF (${address < 0 ? address : hex(address)}…) — the memory has only 256 bytes; ` +
        `qaflisp silently wraps around to $00 and overwrites what is there` });
  }
  diagnostics.push(...symbolProblems(byName, references));
  return diagnostics;
}

module.exports = {
  checkSource, unknownInPassOne, lineProblems, valueProblems, passOneProblem, ignoredOperand, symbolProblems,
  numberProblem, fcbListProblem, explainPhaseError, describeValue,
};
