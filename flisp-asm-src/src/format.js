// Column layout for .sflisp files, without the VS Code API (unit-testable):
// tab stops for the Tab key and the document formatter.
//
// A line has up to four fields: label (column 0), mnemonic, operand, comment.
// `columns` gives the start of mnemonic, operand and comment, default [12, 20, 36].
// Formatting only changes blanks between the fields; lines that qaflisp would reject
// in their structure (e.g. an indented label) are left untouched.

const { parseLine } = require('./symbols');
const { isMnemonic } = require('./mnemonics');

const DEFAULT_COLUMNS = [12, 20, 36];

// Valid columns: three increasing positive integers; otherwise the default.
function normalizeColumns(columns) {
  if (!Array.isArray(columns) || columns.length !== 3) return DEFAULT_COLUMNS;
  const c = columns.map((n) => Math.floor(Number(n)));
  if (c.some((n) => !Number.isFinite(n) || n < 1) || !(c[0] < c[1] && c[1] < c[2])) return DEFAULT_COLUMNS;
  return c;
}

// Visual column of a character position (tabs expand to the next multiple of tabSize).
function visualColumn(text, character, tabSize) {
  let col = 0;
  for (let i = 0; i < character && i < text.length; i++) col = text[i] === '\t' ? col + tabSize - (col % tabSize) : col + 1;
  return col + Math.max(0, character - text.length);
}

// Next tab stop after visual column `col`; beyond the last column, every tabSize columns.
function nextStop(col, columns, tabSize) {
  const next = [0, ...columns].find((c) => c > col);
  return next !== undefined ? next : col + tabSize - ((col - columns[2]) % tabSize);
}

// Previous tab stop before visual column `col`.
function previousStop(col, columns, tabSize) {
  if (col > columns[2]) {
    const back = (col - columns[2]) % tabSize || tabSize;
    return Math.max(columns[2], col - back);
  }
  const prev = [0, ...columns].filter((c) => c < col);
  return prev.length ? prev[prev.length - 1] : 0;
}

// Pads `out` with blanks up to column `col` (at least one blank if out is not empty).
function padTo(out, col) {
  if (out.length === 0) return ' '.repeat(col);
  return out + ' '.repeat(Math.max(1, col - out.length));
}

// Formats one line; returns the line unchanged if its structure is not regular.
function formatLine(text, columns = DEFAULT_COLUMNS) {
  const [cMnemonic, cOperand, cComment] = normalizeColumns(columns);
  const trimmed = text.replace(/[ \t]+$/, '');
  if (trimmed === '') return '';
  if (/^[ \t]*;/.test(trimmed)) return trimmed; // comment line: keep its position

  const p = parseLine(trimmed);
  if (p.invalidLabel) return trimmed; // e.g. a mnemonic in column 1 - leave it for the user to fix
  if (p.mnemonic && !isMnemonic(p.mnemonic.text)) return trimmed; // e.g. an indented label

  let out = '';
  let end = 0;
  if (p.label) {
    end = p.label.end + (trimmed[p.label.end] === ':' ? 1 : 0);
    out = trimmed.slice(0, end);
  }
  if (p.mnemonic) {
    out = padTo(out, cMnemonic) + p.mnemonic.text;
    end = p.mnemonic.end;
  }
  if (p.operand) {
    out = padTo(out, cOperand) + p.operand.text;
    end = p.operand.end;
  }
  const comment = trimmed.slice(end).trim();
  if (comment) out = padTo(out, p.mnemonic ? cComment : Math.max(cMnemonic, out.length + 1)) + comment;
  return out;
}

function formatText(source, columns = DEFAULT_COLUMNS) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return source.split(/\r?\n/).map((l) => formatLine(l, columns)).join(eol);
}

module.exports = { DEFAULT_COLUMNS, normalizeColumns, visualColumn, nextStop, previousStop, formatLine, formatText };
