// FLISP mnemonics and reserved words, as accepted by qaflisp 1.3 (see CONTRIBUTING.md).
// The grammar (syntaxes/flisp.tmLanguage.json) contains the same lists; keep them in sync.

// Instructions without an operand: everything after the mnemonic is a comment.
const INHERENT = [
  'RTS', 'RTI',
  'NOP', 'PSHA', 'PSHX', 'PSHY', 'PSHCC', 'PSHC', 'PULA', 'PULX', 'PULY', 'PULCC', 'PULC',
  'CLRA', 'NEGA', 'INCA', 'DECA', 'TSTA', 'COMA', 'LSLA', 'ASLA', 'LSRA', 'ROLA', 'RORA', 'ASRA',
];

const FLOW = [
  'JSR', 'JMP', 'BSR', 'BRA', 'BCC', 'BCS', 'BEQ', 'BGE', 'BGT', 'BHS', 'BHI', 'BLO',
  'BLE', 'BLS', 'BLT', 'BMI', 'BNE', 'BPL', 'BVC', 'BVS',
];

// END takes an optional start symbol as operand.
const DIRECTIVES = ['ORG', 'EQU', 'FCB', 'FCS', 'RMB', 'END'];

// Lab-specific custom instructions; not known to qaflisp.
const LAB = ['MOVE', 'CMJEQ'];

const OPERAND_INSTRUCTIONS = [
  'LDA', 'LDX', 'LDY', 'LDSP', 'LEAX', 'LEAY', 'LEASP', 'STA', 'STX', 'STY', 'STSP', 'TFR', 'EXG',
  'ADDA', 'ADCA', 'SUBA', 'SBCA', 'CLR', 'NEG', 'DEC', 'INC', 'CMPA', 'CMPX', 'CMPY', 'CMPSP',
  'BITA', 'TST', 'ANDA', 'ORA', 'ANDCC', 'ORCC', 'EORA', 'COM', 'ASR', 'LSL', 'ASL', 'LSR', 'ROL', 'ROR',
];

// Register names are reserved: they cannot be used as symbols (case-insensitive).
const REGISTERS = ['A', 'X', 'Y', 'SP', 'PC', 'CC'];

const set = (list) => new Set(list);
const INHERENT_SET = set(INHERENT);
const WITH_OPERAND_SET = set([...FLOW, ...DIRECTIVES, ...LAB, ...OPERAND_INSTRUCTIONS]);
const ALL_SET = set([...INHERENT_SET, ...WITH_OPERAND_SET]);
const REGISTER_SET = set(REGISTERS);

module.exports = {
  INHERENT, FLOW, DIRECTIVES, LAB, OPERAND_INSTRUCTIONS, REGISTERS,
  isMnemonic: (word) => ALL_SET.has(word.toUpperCase()),
  isInherent: (word) => INHERENT_SET.has(word.toUpperCase()),
  takesOperand: (word) => WITH_OPERAND_SET.has(word.toUpperCase()),
  isRegister: (word) => REGISTER_SET.has(word.toUpperCase()),
};
