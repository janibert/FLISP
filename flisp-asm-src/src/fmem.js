// Syntax check for .fmem memory images (DigiFlisp load files), without the VS Code API.
//
// Format, as written by qaflisp and read by DigiFlisp (see CONTRIBUTING.md; tested with DigiFlisp 2.08):
//   header lines without '#'      ignored by DigiFlisp
//   # ClearAllMemory              commands are case-insensitive; blanks after '#' and around '=' are allowed
//   # ClearAllRegisters
//   #setMemory  20=F0             address and value: 1-2 hex digits each; a later line for the same
//                                 address wins; text after the value is ignored
//   #setRegister ...              name known to DigiFlisp (registers A, X, Y, PC, SP, CC), but no tested
//                                 form (A=A1, X B2, SP=D4, ...) had any effect when loading
// DigiFlisp reports nothing: unknown commands are skipped silently, and invalid hex digits are
// read as 0 ('#setMemory 2G=88' writes to $20).

const COMMANDS = ['setMemory', 'setRegister', 'ClearAllMemory', 'ClearAllRegisters'];
const BY_LOWER = new Map(COMMANDS.map((c) => [c.toLowerCase(), c]));

// Levenshtein distance, for "did you mean" hints.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function similarCommand(word) {
  const w = word.toLowerCase();
  let best;
  for (const c of COMMANDS) {
    const dist = distance(w, c.toLowerCase());
    if (dist <= 3 && (!best || dist < best.dist)) best = { c, dist };
  }
  return best && best.c;
}

const HEX = /^[0-9A-Fa-f]{1,2}$/;

function checkHex(text, what, line, start, out) {
  if (HEX.test(text)) return true;
  const message = /^[0-9A-Fa-f]+$/.test(text)
    ? `${what} '${text}' has too many digits — use 1–2 hex digits (00–FF)`
    : `${what} '${text}' is not a hex number (digits 0–9, A–F) — DigiFlisp reports nothing and reads invalid digits as 0 ('2G' becomes 20)`;
  out.push({ line, start, end: start + text.length, severity: 'error', message });
  return false;
}

function analyzeFmem(source) {
  const lines = source.split(/\r?\n/);
  const diagnostics = [];
  const addresses = new Map(); // address -> first line

  lines.forEach((text, line) => {
    const hash = /^([ \t]*#[ \t]*)([A-Za-z]*)/.exec(text);
    if (!hash) {
      // Not a command: DigiFlisp ignores it. Warn if it looks like a command without '#'.
      const word = /^[ \t]*([A-Za-z]+)/.exec(text);
      if (word && BY_LOWER.has(word[1].toLowerCase())) {
        const start = text.indexOf(word[1]);
        diagnostics.push({ line, start, end: start + word[1].length, severity: 'warning',
          message: `'${word[1]}' without '#' is ignored by DigiFlisp — write #${BY_LOWER.get(word[1].toLowerCase())}` });
      }
      return;
    }
    const name = hash[2];
    const nameStart = hash[1].length;
    const command = BY_LOWER.get(name.toLowerCase());
    if (!command) {
      const similar = name && similarCommand(name);
      const hint = similar ? `did you mean '#${similar}'?` : `known commands: ${COMMANDS.map((c) => '#' + c).join(', ')}`;
      diagnostics.push({ line, start: Math.max(0, nameStart - (name ? 0 : 1)), end: nameStart + Math.max(name.length, 1), severity: 'error',
        message: `Unknown command '#${name}' — DigiFlisp skips this line without a message; ${hint}` });
      return;
    }
    const rest = text.slice(nameStart + name.length);
    const restStart = nameStart + name.length;

    if (command === 'setMemory') {
      const m = /^([ \t]+)([^ \t=;]*)[ \t]*(=?)[ \t]*([^ \t;]*)[ \t]*(.*)$/.exec(rest);
      if (!m || !m[2]) {
        diagnostics.push({ line, start: nameStart, end: nameStart + name.length, severity: 'error',
          message: 'Missing address and value — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0' });
        return;
      }
      const addrStart = restStart + m[1].length;
      if (!m[3]) {
        diagnostics.push({ line, start: addrStart, end: addrStart + m[2].length, severity: 'error',
          message: `Missing '=' — write #setMemory AA=DD (hex), e.g. #setMemory 20=F0` });
        return;
      }
      const valueStart = text.indexOf(m[4], addrStart + m[2].length);
      const okAddr = checkHex(m[2], 'Address', line, addrStart, diagnostics);
      if (!m[4]) {
        diagnostics.push({ line, start: addrStart, end: addrStart + m[2].length + 1, severity: 'error',
          message: 'Missing value after \'=\' — write #setMemory AA=DD (hex)' });
      } else {
        checkHex(m[4], 'Value', line, valueStart, diagnostics);
      }
      if (m[5] && !m[5].startsWith(';')) {
        const s = text.lastIndexOf(m[5]);
        diagnostics.push({ line, start: s, end: s + m[5].length, severity: 'warning',
          message: `Unexpected text after the value: '${m[5]}'` });
      }
      if (okAddr) {
        const key = parseInt(m[2], 16);
        if (addresses.has(key)) {
          diagnostics.push({ line, start: addrStart, end: addrStart + m[2].length, severity: 'warning',
            message: `Address ${m[2].toUpperCase()} is set again (first in line ${addresses.get(key) + 1}); the later value wins` });
        } else {
          addresses.set(key, line);
        }
      }
      return;
    }
    if (command === 'ClearAllMemory' || command === 'ClearAllRegisters') {
      const extra = rest.trim();
      if (extra && !extra.startsWith(';')) {
        const s = text.indexOf(extra, restStart);
        diagnostics.push({ line, start: s, end: s + extra.length, severity: 'warning',
          message: `#${command} takes no arguments` });
      }
    }
    if (command === 'setRegister') {
      // Known name, but no tested form changed a register when the file was loaded in DigiFlisp 2.08.
      diagnostics.push({ line, start: nameStart, end: nameStart + name.length, severity: 'warning',
        message: '#setRegister had no effect in DigiFlisp 2.08 (tested forms: A=A1, X B2, SP=D4, PC=20, CC=05) — ' +
          'set registers in your program instead, e.g. LDSP #$FB' });
    }
  });

  return diagnostics;
}

// --- Column layout ---------------------------------------------------------------
// Command in column 0, argument and comment at `columns` (default [14, 24]):
//   #setMemory    20=05     ; comment
//   #setRegister  A=05
//   # ClearAllMemory        (no argument, may be longer than the argument column)
// Only blanks change. Header lines (no '#') and lines with unknown commands stay as they are.

const DEFAULT_FMEM_COLUMNS = [14, 24];

function normalizeFmemColumns(columns) {
  if (!Array.isArray(columns) || columns.length !== 2) return DEFAULT_FMEM_COLUMNS;
  const c = columns.map((n) => Math.floor(Number(n)));
  if (c.some((n) => !Number.isFinite(n) || n < 1) || !(c[0] < c[1])) return DEFAULT_FMEM_COLUMNS;
  return c;
}

const pad = (out, col) => out + ' '.repeat(Math.max(1, col - out.length));

function formatFmemLine(text, columns = DEFAULT_FMEM_COLUMNS) {
  const [cArg, cComment] = normalizeFmemColumns(columns);
  const trimmed = text.replace(/[ \t]+$/, '');
  if (trimmed === '') return '';
  const m = /^[ \t]*(#[ \t]*)([A-Za-z]+)(.*)$/.exec(trimmed);
  if (!m || !BY_LOWER.has(m[2].toLowerCase())) return trimmed; // header line or unknown command
  const command = m[1] + m[2]; // keeps its spelling, e.g. "# ClearAllMemory"
  let rest = m[3].trim();
  let comment = '';
  const semi = rest.indexOf(';');
  if (semi >= 0) {
    comment = rest.slice(semi).trim();
    rest = rest.slice(0, semi).trim();
  }
  if (BY_LOWER.get(m[2].toLowerCase()) === 'setMemory') rest = rest.replace(/[ \t]*=[ \t]*/, '=');
  let out = command;
  if (rest) out = pad(out, cArg) + rest;
  if (comment) out = pad(out, rest ? cComment : cArg) + comment;
  return out;
}

function formatFmemText(source, columns = DEFAULT_FMEM_COLUMNS) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return source.split(/\r?\n/).map((l) => formatFmemLine(l, columns)).join(eol);
}

// --- Completion ------------------------------------------------------------------
// Only in the command column: the four commands DigiFlisp knows. The ClearAll commands are
// inserted as qaflisp writes them ("# ClearAllMemory"), the spelling tested with DigiFlisp.

const COMPLETIONS = [
  { insert: '#setMemory', filter: '#setMemory', detail: 'write a byte: #setMemory AA=DD (hex)', takesArgument: true },
  { insert: '#setRegister', filter: '#setRegister', detail: 'set a register — had no effect in DigiFlisp 2.08', takesArgument: true },
  { insert: '# ClearAllMemory', filter: '#ClearAllMemory', detail: 'clear the whole memory', takesArgument: false },
  { insert: '# ClearAllRegisters', filter: '#ClearAllRegisters', detail: 'clear all registers', takesArgument: false },
];

// Suggestions at `character`, or [] outside the command column. `start` is where the
// replaced text begins (at the '#' if one was typed).
function fmemCompletionsAt(text, character) {
  const before = text.slice(0, character);
  const m = /^([ \t]*)(#?[ \t]*[A-Za-z]*)$/.exec(before);
  if (!m) return { start: character, items: [] };
  return { start: m[1].length, items: COMPLETIONS };
}

// After accepting a command: does it take an argument (then Tab moves on to the argument column)?
function fmemCommandTakesArgument(text) {
  const m = /^[ \t]*#[ \t]*([A-Za-z]+)[ \t]*$/.exec(text);
  return Boolean(m && ['setmemory', 'setregister'].includes(m[1].toLowerCase()));
}

module.exports = {
  analyzeFmem, COMMANDS, DEFAULT_FMEM_COLUMNS, normalizeFmemColumns, formatFmemLine, formatFmemText,
  fmemCompletionsAt, fmemCommandTakesArgument,
};
