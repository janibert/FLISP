// Addresses of the lines of a FLISP source, computed like qaflisp 1.3 (no VS Code API; measured,
// see CONTRIBUTING.md "Addresses"):
//   - the location counter starts at 0; ORG sets it; it is not wrapped at $FF (labels can be $122),
//     only the bytes are written to address & $FF
//   - every instruction variant has a fixed length (src/instructions.js); FCB: one byte per value,
//     FCS: one byte per character (\x counts once), RMB: its value
//   - a line qaflisp rejects for its syntax (bad operand, addressing mode, register pair, number,
//     '#') occupies 0 bytes; an undefined symbol, a value out of range or a division by zero do not
//     change the length; FCB writes the values before the first such syntax error
//   - a line whose label is defined twice is not assembled; qaflisp's addresses after it are
//     unreliable (phase error), so the layout stops there, as it does at an ORG/RMB whose value
//     is not known

const { INSTRUCTIONS } = require('./instructions');
const { modeOf, checkOperand, checkImmediateMarker, hashPositions } = require('./addressing');
const { tokenize, parse, numberValue, evaluate } = require('./expression');
const { isMnemonic } = require('./mnemonics');

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

// How qaflisp generates code for an expression: 'ok', 'fail' (syntax error: no code) or
// 'partial': a complete value followed by one of = . : < > ("Bad delimiter", "Reached
// unreacheable point") — FCB still writes that value and stops the list there.
// Values (undefined symbols, range, division by zero) do not matter.
function syntaxOf(text) {
  if (text === '' || hashPositions(text).length) return 'fail';
  if (tokenize(text).some((t) => t.type === 'number' && numberValue(t.text) === undefined)) return 'fail';
  const { problem } = parse(text);
  if (!problem || problem.severity !== 'error' || problem.message === 'Integer divide by zero') return 'ok';
  const c = text[problem.start];
  if ('=.:<>'.includes(c) && problem.message.startsWith('Unexpected character') && problem.start > 0 && syntaxOf(text.slice(0, problem.start)) === 'ok') {
    return c === '<' || c === '>' ? 'partial<>' : 'partial';
  }
  return 'fail';
}
const syntaxFails = (text) => syntaxOf(text) !== 'ok';

// Bytes of an FCS operand: the characters of the string ("\x" counts once). Measured quirks:
// FCS "" writes 2 bytes, a string without closing quote gets an extra newline byte, FCS #"AB" none.
function fcsSize(operand) {
  if (!operand.startsWith('"')) return 0;
  let n = 0;
  let i = 1;
  while (i < operand.length && operand[i] !== '"') {
    i += operand[i] === '\\' ? 2 : 1;
    n++;
  }
  if (i >= operand.length) return n + 1;
  return n === 0 ? 2 : n;
}

// Size of an instruction line in bytes (0 if qaflisp rejects its syntax).
function instructionSize(mn, operand) {
  const d = INSTRUCTIONS[mn];
  const inherent = d.variants.find((v) => v.mode === 'inh');
  if (operand === undefined) return inherent ? inherent.bytes : 0; // missing operand: Syntax Error
  if (checkOperand(mn, operand) || checkImmediateMarker(mn, operand)) return 0;
  // LDA 1<2 is assembled (qaflisp quirk), LDA 1=2 is not
  if (expressionParts(mn, operand).some((part) => !['ok', 'partial<>'].includes(syntaxOf(part.text)))) return 0;
  const { mode } = modeOf(mn, operand);
  const variant = d.variants.find((v) => v.mode === mode);
  return variant ? variant.bytes : 0;
}

// records: [{ line, p }] in source order up to END (p = parseLine result).
// twice: Set of names defined more than once. valueOf(name): values known before the layout
// (constants); labels are added while going through the lines, as in qaflisp's pass 1.
// unknownInPassOne: lines (ORG, RMB) whose value qaflisp does not know in pass 1 - the layout stops.
// Returns { lines: Map line -> { address, size }, labels: Map name -> address,
//           beyond: first line with bytes beyond $FF, stoppedAt: line where the layout stopped }.
function computeLayout(records, twice, valueOf, unknownInPassOne = new Set()) {
  const lines = new Map();
  const labels = new Map();
  const known = (name) => (labels.has(name) ? labels.get(name) : valueOf(name));
  let loc = 0;
  let beyond;
  for (const { line, p } of records) {
    if (p.invalidLabel) {
      lines.set(line, { address: loc, size: 0 });
      continue;
    }
    if (p.label && twice.has(p.label.name)) return { lines, labels, beyond, stoppedAt: line };
    if (unknownInPassOne.has(line)) return { lines, labels, beyond, stoppedAt: line }; // ORG/RMB, see symbols.js
    const mn = p.mnemonic && isMnemonic(p.mnemonic.text) ? p.mnemonic.text.toUpperCase() : undefined;
    const operand = p.operand ? p.operand.text : undefined;
    if (mn === 'ORG') {
      const v = operand === undefined ? undefined : evaluate(operand, known);
      if (v === undefined) return { lines, labels, beyond, stoppedAt: line };
      loc = v;
    }
    if (p.label && mn !== 'EQU') labels.set(p.label.name, loc);
    let size = 0;
    if (mn === 'RMB') {
      const v = operand === undefined ? undefined : evaluate(operand, known);
      if (v === undefined) return { lines, labels, beyond, stoppedAt: line };
      size = Math.max(v, 0);
    } else if (mn === 'FCB' && operand !== undefined) {
      const items = listItems(operand);
      const bad = items.findIndex((item) => syntaxFails(item.text));
      // a value followed by a stray delimiter (1=2, 1.5) is still written, then the list ends
      size = bad < 0 ? items.length : bad + (syntaxOf(items[bad].text).startsWith('partial') ? 1 : 0);
    } else if (mn === 'FCS' && operand !== undefined) {
      size = fcsSize(operand);
    } else if (mn && INSTRUCTIONS[mn]) {
      size = instructionSize(mn, operand);
    }
    lines.set(line, { address: loc, size });
    if (beyond === undefined && size > 0 && (loc < 0 || loc + size > 0x100)) beyond = line;
    loc += size;
    if (mn === 'END') break;
  }
  return { lines, labels, beyond, stoppedAt: undefined };
}

module.exports = { computeLayout, expressionParts, listItems, fcsSize, instructionSize };
