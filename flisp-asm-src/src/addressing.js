// Addressing mode of an operand and the check whether an instruction supports it
// (no VS Code API; used by the hover and by the live check).

const { INSTRUCTIONS, MODES } = require('./instructions');

const BRANCHES = new Set(Object.entries(INSTRUCTIONS)
  .filter(([, d]) => d.variants.some((v) => v.mode === 'rel')).map(([mn]) => mn));

// Addressing mode of an operand as written in the source.
// mode 'bad' = the operand is malformed (qaflisp: "Syntax Error").
function modeOf(mnemonic, operand) {
  const mn = mnemonic.toUpperCase();
  if (!operand) return { mode: 'inh' };
  const o = operand.trim();
  if (mn === 'TFR' || mn === 'EXG') return { mode: 'reg', operand: o.toUpperCase() };
  if (o.startsWith('#')) {
    return o.includes(',') ? { mode: 'bad', reason: 'immediate data cannot be combined with an index register' } : { mode: 'imm' };
  }
  let m = /^,([+-]?)([XY])([+-]?)$/i.exec(o);
  if (m && !(m[1] && m[3])) {
    const r = m[2].toLowerCase();
    if (m[1] === '+') return { mode: `inc${r}` };
    if (m[1] === '-') return { mode: `dec${r}` };
    if (m[3] === '+') return { mode: `${r}inc` };
    if (m[3] === '-') return { mode: `${r}dec` };
    // ",X" without + or -: not a FLISP addressing mode
  }
  m = /^A,([XY])$/i.exec(o);
  if (m) return { mode: `a${m[1].toLowerCase()}` };
  if (/^A,SP$/i.test(o)) return { mode: 'bad', reason: 'the A offset works with X and Y only (A,X  A,Y)' };
  m = /^,(X|Y|SP)$/i.exec(o);
  if (m) return { mode: 'bad', reason: `write 0,${m[1].toUpperCase()} for the address in ${m[1].toUpperCase()} itself` };
  m = /^.+,(SP|X|Y)$/i.exec(o);
  if (m && !o.startsWith(',')) return { mode: m[1].toUpperCase() === 'SP' ? 'nsp' : `n${m[1].toLowerCase()}` };
  if (o.includes(',')) {
    return { mode: 'bad', reason: 'indexed addressing uses X, Y or SP: n,X  A,X  ,X+  ,X-  ,+X  ,-X  n,SP' };
  }
  return { mode: BRANCHES.has(mn) ? 'rel' : 'abs' };
}

const syntaxOf = (v) => (v.mode === 'reg' ? v.operand : MODES[v.mode].syntax);

// Checks the operand of an instruction. Returns undefined if it is fine, otherwise
// { kind, message } with kind 'missing' | 'bad' | 'mode' | 'pair'.
function checkOperand(mnemonic, operand) {
  const mn = mnemonic.toUpperCase();
  const d = INSTRUCTIONS[mn];
  if (!d || d.variants.every((v) => v.mode === 'inh')) return undefined; // unknown, or no operand
  const allowed = [...new Set(d.variants.map(syntaxOf))].join('  ');
  if (!operand) return { kind: 'missing', message: `Missing operand — ${mn} needs one of: ${allowed}` };
  const used = modeOf(mn, operand);
  if (used.mode === 'bad') return { kind: 'bad', message: `Bad operand '${operand}' — ${used.reason}` };
  if (used.mode === 'reg') {
    if (d.variants.some((v) => v.operand === used.operand)) return undefined;
    return { kind: 'pair', message: `Illegal register combination '${operand}' — ${mn} allows ${allowed}` };
  }
  if (d.variants.some((v) => v.mode === used.mode)) return undefined;
  const mode = MODES[used.mode];
  return { kind: 'mode', message: `Illegal addressing mode — ${mn} has no ${mode.name.toLowerCase()} addressing (${mode.syntax}); allowed: ${allowed}` };
}

module.exports = { modeOf, checkOperand, BRANCHES };
