# Changelog

## Unreleased

- Syntax check for `.fmem` files while typing: unknown commands (with a hint for typos), invalid hex addresses and values, missing `=` or value, commands without `#`, and addresses set twice. Messages explain what DigiFlisp silently does instead (e.g. `2G` is read as `20`); `#setRegister` gets a warning because it had no effect in DigiFlisp 2.08.

## 0.7.0

- Instruction reference on hover: hovering a mnemonic shows the addressing mode, operation, opcode, bytes and cycles of the variant used on that line, the flags it changes, and a table of all variants. Directives and lab instructions get a short explanation. Opcodes and lengths are checked against qaflisp.
- Live check for operands: addressing modes an instruction does not have (`STA #5`, `CLR ,X+`), wrong register pairs (`TFR A,X`), missing operands and malformed operands (`#5,X`, `3,PC`, `A,SP`, `,X`) are underlined while typing; the message lists the allowed forms.
- README: how to assemble comes first; new screenshot.

## 0.6.0

- Labels and symbols: Go to Definition (`F12`), Find All References (`Shift+F12`), highlighting of all occurrences, Outline / breadcrumbs / `Ctrl+Shift+O`, hover with the defining line, rename (`F2`).
- Live check while typing: undefined symbols (with a hint when only the case differs) and multiple definitions are underlined without assembling. On lines with a qaflisp message the live check steps back; editing a line removes the outdated qaflisp message there.
- The live check also finds unknown mnemonics, a mnemonic in column 1 and labels that are accidentally indented ("if 'Start' is a label, it must start in column 1").
- qaflisp's *Phase error between passes* is explained, with a link to the multiple definition that usually causes it.

## 0.5.1 (not published)

- Assembler directives (`ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END`) are clearly distinguished from instructions: own colour (scope `support.type.directive` instead of `keyword.other.directive`) and bold by default.
- The immediate marker `#` is bold by default, so `LDA #5` and `LDA 5` are easy to tell apart.

## 0.5.0

- Symbols used in operands (labels, `EQU` constants) are highlighted (`variable.parameter.symbol`), e.g. `BRA Loop`, `STA LEDS`.
- README: screenshot; `LICENSE` and `THIRD-PARTY-NOTICES.md` are links to the files on GitHub.
- `package.json`: `author` field.

## 0.4.1

- Documentation only: shorter user README; building, testing and file layout moved to the repository README.

## 0.4.0

- qaflisp.exe (Windows) is now bundled and used if no other copy is found.
- qaflisp is also looked for in the DigiFlisp installation folder on Windows (`Program Files\GMV\DigiFlisp*`), Linux (`/usr/share/digiflisp`) and macOS (`/Applications/Digiflisp.app`).
- Errors are counted from qaflisp's messages, so the Linux build (which exits with 0 even on errors) is handled too.
- First release on the Visual Studio Marketplace.

## 0.3.0

- New command *FLISP: Assemble* (editor title button, `F7`, Explorer context menu): runs qaflisp and shows errors and warnings in the editor and the Problems panel.
- Settings for the qaflisp path, assemble on save, list file, warnings and debug information.
- `END` takes its optional start symbol as operand.

## 0.2.0

- Grammar follows qaflisp's line structure: text after the operand is a comment, a mnemonic in column 1 is flagged as an error.
- Lab instructions `MOVE` and `CMJEQ` get their own scope, shown italic and underlined.
- Character constants `'A'`, directive `END`, `.fmem` commands `# ClearAllMemory` / `# ClearAllRegisters`.
- Instructions use the scope `keyword.other.instruction`, so they are coloured in more themes.
- DigiFlisp icon.

## 0.1.0

- Syntax highlighting for `.sflisp` and `.fmem`.
