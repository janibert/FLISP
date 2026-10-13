// FLISP mnemonic, directive and register lists, derived from src/instructions.js
// (the single source of the instruction set; see CONTRIBUTING.md).
//
// scripts/build-grammar.js inserts these lists into syntaxes/flisp.tmLanguage.template.json
// and writes syntaxes/flisp.tmLanguage.json. After changing src/instructions.js,
// run `npm run build:grammar` (npm test fails until you do).

const { INSTRUCTIONS, DIRECTIVES: DIRECTIVE_INFO, LAB: LAB_INFO } = require('./instructions');

const entries = Object.entries(INSTRUCTIONS);
const isInherentEntry = (d) => d.variants.every((v) => v.mode === 'inh');
const pick = (group, inherent) => entries
  .filter(([, d]) => d.group === group && isInherentEntry(d) === inherent)
  .map(([mn]) => mn);

// Instructions without an operand: everything after the mnemonic is a comment.
const INHERENT_FLOW = pick('flow', true); // RTS, RTI (coloured like branches)
const INHERENT = pick('other', true);
// Instructions with an operand.
const FLOW = pick('flow', false);
const OPERAND_INSTRUCTIONS = pick('other', false);
// Assembler directives (END takes an optional start symbol) and lab-specific instructions.
const DIRECTIVES = Object.keys(DIRECTIVE_INFO);
const LAB = Object.keys(LAB_INFO);

// Register names are reserved: they cannot be used as symbols (case-insensitive).
const REGISTERS = ['SP', 'PC', 'CC', 'A', 'X', 'Y'];

const ALL = [...INHERENT_FLOW, ...INHERENT, ...FLOW, ...DIRECTIVES, ...LAB, ...OPERAND_INSTRUCTIONS];

const set = (list) => new Set(list);
const INHERENT_SET = set([...INHERENT_FLOW, ...INHERENT]);
const ALL_SET = set(ALL);
const REGISTER_SET = set(REGISTERS);

module.exports = {
  INHERENT_FLOW, INHERENT, FLOW, DIRECTIVES, LAB, OPERAND_INSTRUCTIONS, REGISTERS, ALL,
  isMnemonic: (word) => ALL_SET.has(word.toUpperCase()),
  isInherent: (word) => INHERENT_SET.has(word.toUpperCase()),
  takesOperand: (word) => ALL_SET.has(word.toUpperCase()) && !INHERENT_SET.has(word.toUpperCase()),
  isRegister: (word) => REGISTER_SET.has(word.toUpperCase()),
};
