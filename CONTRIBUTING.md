# Contributing

Contributions to the grammar, the qaflisp integration and the documentation are welcome. Building, testing and the file layout are described in the [README](README.md); this file collects the domain knowledge about FLISP, qaflisp and DigiFlisp that the extension is built on.

- Write code, documentation, commit messages and issues in English.
- Run `npm test` in `flisp-asm-src/` before opening a pull request, and add a test case for every grammar change.
- If you find qaflisp behaving differently from what is described below, please open an issue or update this file together with the grammar.

## Sources of truth

1. **FLISP-Handbok** (version 2025-12-09), the description of the FLISP processor and its assembly language: [FlisProcessorHandbok-A4.pdf](https://www.gbgmv.se/dl/pdf/FlisProcessorHandbok-A4.pdf). Instruction set: p. 10 (instruction groups) and p. 11 (opcode map); addressing modes pp. 5–8; assembler directives p. 9.
2. **qaflisp's actual behaviour** decides wherever the handbook is silent or vague. Verify syntax by assembling small probe files in a scratch directory — `qaflisp -L -w probe.sflisp` — and look at the console output, the exit code and `probe.lst`. Do not guess.

qaflisp and DigiFlisp are made by GMV (Göteborgs MikroVaror) and are available from [www.gbgmv.se](https://www.gbgmv.se/studies.html).

## qaflisp 1.3 behaviour

The grammar and the extension depend on the following, verified with qaflisp 1.3.

### Line structure

Every line is `[Label] Mnemonic [Operand] [Comment]`.

- Column 1 is always a label (optionally followed by `:`). An indented label, or a mnemonic in column 1, gives *Illegal mnemonic*. The grammar therefore flags a mnemonic in column 1 as an error.
- The operand ends at the first whitespace outside a string; everything after it is a comment, no `;` needed. Consequence: `LDA #K + 1` assembles as `LDA #K`.
- For instructions without an operand (`NOP`, `PSHA`, `RTS`, `INCA` …), everything after the mnemonic is a comment.
- A `;` directly after an operand without a space (`LDA #1;x`) gives *Syntax Error*. Comments starting with `*` are not supported.
- `END` takes an optional start symbol, which sets the start address in the S9 record of the `.s19` file (it does not appear in the `.fmem` file). Text after the symbol is a comment. An undefined symbol gives the misleading warning *start symbol 'X' is defined* (meaning: not defined). Nothing after `END` is assembled.

### Syntax details

- Directives: `ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END`. `FDB`, `SET` and `INCLUDE` give *Illegal mnemonic*.
- Mnemonics are case-insensitive. Accepted aliases: `PSHCC`/`PULCC` (= `PSHC`/`PULC`), `ASL`/`ASLA` (= `LSL`/`LSLA`). `ROL`, `ASL` etc. without an operand are errors — the forms operating on register A end in `A` (`ROLA`, `ASLA`).
- Character constants need the closing quote: `'A'`, not `'A`. `FCS` strings support `\"`.
- `TFR`/`EXG` register pairs: `A,CC` `CC,A` `X,Y` `Y,X` `X,SP` `SP,X` `Y,SP` `SP,Y`. `A,C` (as written in the opcode map) gives *Bad register pair*.
- There is no PC-indexed addressing (`2,PC` gives *Syntax Error*); indexed addressing uses X, Y or SP only.
- `MOVE` and `CMJEQ` are lab-specific custom instructions; neither the handbook nor qaflisp knows them. The extension highlights them with their own scope so they stand out as non-standard.

### Output files and messages

- qaflisp writes `.s19`, `.lst` and `.fmem` into the **current working directory**, not next to the source. The extension therefore runs it in the source file's folder.
- Messages:
  - `<file> (<line>) Error: <text>`
  - `<file> (<line>) Warning: <text>` — only with `-w`
  - `<file> (<line>)Fatal error: <text>` — note the missing space
  - optional suffix `, Position[<col>]` with a **0-based** column
  - summary `-- N error(s).` or `No errors.`; the file path is echoed as it was passed on the command line.
- Exit code: on Windows the number of errors; the **Linux build exits with 0 even on errors**. Count errors from the messages, not from the exit code.
- `.fmem` format: header lines (`QAflisp - …`, `(c) GMV …`, `File: …`), then ` # ClearAllMemory`, ` # ClearAllRegisters` and one ` #setMemory  20=F0` line per byte (leading space, two spaces after `#setMemory`).

## DigiFlisp and where qaflisp is installed

DigiFlisp 2.08 is available for Windows, Linux (x64, `.deb` and `.tar.gz`) and macOS (Intel and Apple silicon). Every package includes qaflisp:

| Platform | qaflisp location |
|---|---|
| Windows | `Program Files (x86)\GMV\DigiFlisp<n>\qaflisp.exe` — DigiFlisp itself expects qaflisp next to `digiflisp.exe` |
| Linux `.deb` | `/usr/share/digiflisp/qaflisp` (not on the `PATH`) |
| Linux `.tar.gz` | wherever it is unpacked; the install instructions use `/usr/bin` |
| macOS | `/Applications/Digiflisp.app/Contents/MacOS/qaflisp` |

The Linux x64 build prints the same messages and produces identical `.s19` and `.fmem` files as the Windows build (apart from the exit code, see above). The macOS builds have only been checked from the package contents (same message formats); feedback from macOS users is welcome.
