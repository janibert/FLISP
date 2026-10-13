// FLISP mnemonics and reserved words, as accepted by qaflisp 1.3 (see CONTRIBUTING.md).
//
// This is the single source of these lists: scripts/build-grammar.js inserts them into
// syntaxes/flisp.tmLanguage.template.json and writes syntaxes/flisp.tmLanguage.json.
// After changing a list, run `npm run build:grammar` (npm test fails until you do).

// Instructions without an operand: everything after the mnemonic is a comment.
// Flow control (coloured like branches):
const INHERENT_FLOW = ['RTS', 'RTI'];
// All others:
const INHERENT = [
  'NOP', 'PSHA', 'PSHX', 'PSHY', 'PSHCC', 'PSHC', 'PULA', 'PULX', 'PULY', 'PULCC', 'PULC',
  'CLRA', 'NEGA', 'INCA', 'DECA', 'TSTA', 'COMA', 'LSLA', 'ASLA', 'LSRA', 'ROLA', 'RORA', 'ASRA',
];

// Instructions and directives with an operand.
const FLOW = [
  'JSR', 'JMP', 'BSR', 'BRA', 'BCC', 'BCS', 'BEQ', 'BGE', 'BGT', 'BHS', 'BHI', 'BLO',
  'BLE', 'BLS', 'BLT', 'BMI', 'BNE', 'BPL', 'BVC', 'BVS',
];

// Assembler directives. END takes an optional start symbol as operand.
const DIRECTIVES = ['ORG', 'EQU', 'FCB', 'FCS', 'RMB', 'END'];

// Lab-specific custom instructions; not known to qaflisp.
const LAB = ['MOVE', 'CMJEQ'];

const OPERAND_INSTRUCTIONS = [
  'LDA', 'LDX', 'LDY', 'LDSP', 'LEAX', 'LEAY', 'LEASP', 'STA', 'STX', 'STY', 'STSP', 'TFR', 'EXG',
  'ADDA', 'ADCA', 'SUBA', 'SBCA', 'CLR', 'NEG', 'DEC', 'INC', 'CMPA', 'CMPX', 'CMPY', 'CMPSP',
  'BITA', 'TST', 'ANDA', 'ORA', 'ANDCC', 'ORCC', 'EORA', 'COM', 'ASR', 'LSL', 'ASL', 'LSR', 'ROL', 'ROR',
];

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
