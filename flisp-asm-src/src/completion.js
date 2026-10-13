// Context-sensitive completion for .sflisp files, without the VS Code API (unit-testable).
// The column of the cursor decides what is offered:
//   label column    symbols that are used but not defined yet
//   mnemonic column mnemonics, directives, lab instructions
//   operand column  depends on the mnemonic: code labels for branches and jumps, register pairs
//                   for TFR/EXG, index registers after a comma, constants first after '#'
//   comment         nothing

const { parseLine } = require('./symbols');
const { INSTRUCTIONS, MODES, DIRECTIVES, LAB } = require('./instructions');
const { isMnemonic, isRegister } = require('./mnemonics');

const IDENT_BEFORE = /[A-Za-z_][A-Za-z0-9_]*$/;

// Which field of the line the cursor is in.
function fieldAt(text, character) {
  const before = text.slice(0, character);
  const word = (before.match(IDENT_BEFORE) || [''])[0];
  const wordStart = character - word.length;
  if (wordStart === 0 && /^[A-Za-z_]?$/.test(text[0] || '')) return { field: 'label' };
  if (/^[ \t]*;/.test(text) || /;/.test(before)) return { field: 'comment' };

  const p = parseLine(text);
  if (p.invalidLabel) return { field: 'none' };
  const m = p.mnemonic;
  // Cursor in (or right before) the mnemonic, or no mnemonic yet.
  if (!m || (wordStart >= m.start && wordStart <= m.end && character <= m.end)) {
    const labelEnd = p.label ? p.label.end : 0;
    if (character > labelEnd && /^[ \t]*[A-Za-z_]*$/.test(before.slice(labelEnd).replace(/^:/, ''))) return { field: 'mnemonic' };
    return { field: 'none' };
  }
  if (!isMnemonic(m.text)) return { field: 'none' };
  const d = INSTRUCTIONS[m.text.toUpperCase()];
  if (d && d.variants.every((v) => v.mode === 'inh')) return { field: 'comment' };
  if (p.operand && character > p.operand.end) return { field: 'comment' };
  if (!p.operand && /[^ \t][ \t]+[^ \t]+[ \t]+/.test(before.slice(m.start))) return { field: 'comment' };
  const operandBefore = p.operand && character >= p.operand.start ? text.slice(p.operand.start, wordStart) : '';
  return { field: 'operand', mnemonic: m.text.toUpperCase(), operandBefore };
}

const kindOrder = { constant: '1', data: '2', code: '3' };

function symbolItems(analysis, prefer) {
  return analysis.definitions
    .filter((d, i, all) => all.findIndex((o) => o.name === d.name) === i)
    .map((d) => ({
      label: d.name,
      kind: d.kind, // code | data | constant
      detail: d.text.trim(),
      sort: (prefer.includes(d.kind) ? '0' : '1') + kindOrder[d.kind] + d.name,
    }));
}

// Index registers that the mnemonic allows after the text typed so far in the operand.
function indexItems(mnemonic, operandBefore) {
  const d = INSTRUCTIONS[mnemonic];
  if (!d) return [];
  const syntaxes = d.variants.map((v) => MODES[v.mode].syntax).filter(Boolean);
  const items = new Set();
  if (/^,$/.test(operandBefore)) {
    // ",X+"  ",-Y" ... : offer the part after the comma
    for (const s of syntaxes) if (s.startsWith(',')) items.add(s.slice(1));
  } else if (/^,[+-]$/.test(operandBefore)) {
    for (const s of syntaxes) if (s.startsWith(operandBefore)) items.add(s.slice(2));
  } else if (/,$/.test(operandBefore)) {
    // "n,X"  "A,Y"  "n,SP"
    for (const s of syntaxes) if (/^(n|A),/.test(s)) items.add(s.split(',')[1]);
  }
  return [...items].map((r) => ({ label: r, kind: 'register', detail: `${mnemonic} …,${r}`, sort: '0' + r }));
}

function completionsAt(text, character, analysis) {
  const ctx = fieldAt(text, character);
  if (ctx.field === 'label') {
    const defined = new Set(analysis.definitions.map((d) => d.name));
    const missing = [...new Set(analysis.references.map((r) => r.name))].filter((n) => !defined.has(n));
    return missing.map((n) => ({ label: n, kind: 'undefined', detail: 'used, but not defined yet', sort: n }));
  }
  if (ctx.field === 'mnemonic') {
    return [
      ...Object.entries(INSTRUCTIONS).map(([mn, d]) => ({
        label: mn, kind: 'mnemonic', detail: d.title + (d.alias ? ` (same as ${d.alias})` : ''), sort: '1' + mn,
      })),
      ...Object.entries(DIRECTIVES).map(([mn, d]) => ({ label: mn, kind: 'directive', detail: `${d.title} — ${d.syntax}`, sort: '2' + mn })),
      ...Object.entries(LAB).map(([mn, d]) => ({ label: mn, kind: 'lab', detail: d.title, sort: '3' + mn })),
    ];
  }
  if (ctx.field !== 'operand') return [];

  const mn = ctx.mnemonic;
  const before = ctx.operandBefore;
  if (mn === 'TFR' || mn === 'EXG') {
    if (before) return [];
    return INSTRUCTIONS[mn].variants.map((v) => ({ label: v.operand, kind: 'register', detail: `${mn} ${v.operand}`, sort: v.operand }));
  }
  if (/,[+-]?$/.test(before)) return indexItems(mn, before);
  if (['FCS'].includes(mn)) return [];

  const branchLike = INSTRUCTIONS[mn] && INSTRUCTIONS[mn].group === 'flow';
  if (branchLike || mn === 'END') return symbolItems(analysis, ['code']);
  if (before.startsWith('#') || mn === 'ORG' || mn === 'EQU' || mn === 'RMB') return symbolItems(analysis, ['constant']);
  return symbolItems(analysis, ['data', 'constant']);
}

module.exports = { completionsAt, fieldAt, isRegister };
