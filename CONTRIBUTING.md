# Contributing

Contributions to the grammar, the qaflisp integration and the documentation are welcome. Building, testing and the file layout are described in the [README](README.md); this file collects the domain knowledge about FLISP, qaflisp and DigiFlisp that the extension is built on.

- Write code, documentation, commit messages and issues in English.
- Run `npm test` in `flisp-asm-src/` before opening a pull request, and add a test case for every grammar change.
- The `.sflisp` grammar is generated: edit `syntaxes/flisp.tmLanguage.template.json` or the instruction table in `src/instructions.js`, then run `npm run build:grammar` (see the [README](README.md)).
- If you find `qaflisp` behaving differently from what is described below, please open an issue or update this file together with the grammar.

## Sources of truth

1. **FLISP-Handbok** (version 2025-12-09), the description of the FLISP processor and its assembly language: [FlisProcessorHandbok-A4.pdf](https://www.gbgmv.se/dl/pdf/FlisProcessorHandbok-A4.pdf). Instruction set: p. 10 (instruction groups) and p. 11 (opcode map); addressing modes pp. 5–8; assembler directives p. 9.
2. **qaflisp's actual behaviour** decides wherever the handbook is silent or vague. Verify syntax by assembling small probe files in a scratch directory — `qaflisp -L -w probe.sflisp` — and look at the console output, the exit code and `probe.lst`. Do not guess.

qaflisp and DigiFlisp are made by GMV (Göteborgs MikroVaror) and are available from [www.gbgmv.se](https://www.gbgmv.se/studies.html).

## qaflisp 1.3 behaviour

The grammar and the extension depend on the following, verified with qaflisp 1.3.

### Line structure

Every line is `[Label] Mnemonic [Operand] [Comment]`.

- Column 1 is always a label (optionally followed by `:`), even if it is named like a mnemonic: `Neg EQU 3`, `End NOP` and `Inc INCA` are valid. A mnemonic in column 1 followed by something that is not a mnemonic (`LDA #1`) gives *Illegal mnemonic*, and so does an indented label. A mnemonic alone in column 1 (`NOP`, `RTS ; c`) is silently a label without code — usually a missing indent; the live check warns, the grammar flags only the `LDA #1` case.
- The operand ends at the first whitespace outside a string; everything after it is a comment, no `;` needed. Consequence: `LDA #K + 1` assembles as `LDA #K`.
- For instructions without an operand (`NOP`, `PSHA`, `RTS`, `INCA` …), everything after the mnemonic is a comment, without any message — also `PSHA $3`, `NOP #5` and `ASLA Data` (which shifts A, not `Data`). The live check warns when the first word looks like an operand (starts with `#` `$` `%` `'` `(` `,` `-` or a digit, is an indexed form like `2,X`, or is a symbol of the file, also in an expression like `Data+1`) and suggests the memory form (`ASL Data`) where it exists; plain words (`RTS back to caller`) stay comments.
- A `;` directly after an operand without a space (`LDA #1;x`) gives *Syntax Error*. Comments starting with `*` are not supported.
- `END` takes an optional start symbol, which sets the start address in the S9 record of the `.s19` file (it does not appear in the `.fmem` file). Text after the symbol is a comment. An undefined symbol gives the misleading warning *start symbol 'X' is defined* (meaning: not defined). Nothing after `END` is assembled.

### Syntax details

- Directives: `ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END`. `FDB`, `SET` and `INCLUDE` give *Illegal mnemonic*.
- Mnemonics are case-insensitive. Accepted aliases: `PSHCC`/`PULCC` (= `PSHC`/`PULC`), `ASL`/`ASLA` (= `LSL`/`LSLA`). `ROL`, `ASL` etc. without an operand are errors — the forms operating on register A end in `A` (`ROLA`, `ASLA`).
- Numbers: `$1F` hex, `%0101` binary, `42` decimal (`077` is decimal 77, not octal). A number runs to the end of the word; a digit that does not fit the base gives *Illegal decimal digit* (`0a`, `1F`, `0x1F`, `1_0`), *Illegal binary digit* (`%0102`, `%0b`) or *Illegal hexadecimal digit* (`$FG`); `$` or `%` without digits gives the same messages. Hex digits are case-insensitive (`$0a`).
- Character constants need the closing quote: `'A'`, not `'A`. `FCS` strings support `\"`.
- `TFR`/`EXG` register pairs: `A,CC` `CC,A` `X,Y` `Y,X` `X,SP` `SP,X` `Y,SP` `SP,Y`. `A,C` (as written in the opcode map) gives *Bad register pair*.
- There is no PC-indexed addressing (`2,PC` gives *Syntax Error*); indexed addressing uses X, Y or SP only.
- `MOVE` and `CMJEQ` are lab-specific custom instructions; neither the handbook nor qaflisp knows them. The extension highlights them with their own scope so they stand out as non-standard.

### Symbols (labels and `EQU` constants)

The live symbol check (`src/symbols.js`) follows these rules; `test/symbols-test.js` compares it with the real qaflisp.

- **Symbols are case-sensitive**: `Loop` and `loop` are two different symbols and may both be defined; `BRA loop` does not find `Loop` (*Undefined symbol 'loop'*). Mnemonics and register names are case-insensitive.
- A name consists of letters, digits and `_`; a digit at the start gives *Illegal label*. In the label column qaflisp also accepts `$` and `.` after the first character (`A$b`, `x.y`), but such a label cannot be used in an operand (`BRA x.y`: *Bad operand syntax*); `q#r` gives *Illegal mnemonic*. The `:` after a label is not part of the name (`L1:` is used as `L1`; `BRA L1:` gives *Bad operand syntax*).
- Register names (`A`, `X`, `Y`, `SP`, `PC`, `CC`, any case) are reserved: `X EQU 3` is accepted, but using `X` as a value gives *Illegal use of reserved word*.
- Forward references are allowed (`LDA #K` before `K EQU 3`), except in `ORG` (*Forward reference*). An `EQU` that uses a later `EQU` gives the warning *symbol 'M' is forward referenced from line 2*.
- Symbols can be used in expressions and indexed operands: `LDA Tab+1`, `LDX #Tab`, `LDA Off,X`, `FCB Start`.
- Labels after `END` are not defined — `END` stops the assembly.
- Multiple definitions are reported inconsistently: two labels → *Multiple definition* on both lines; label and `EQU` → *Multiple definition* on one line; two `EQU`s → *symbol 'K' previously defined at line 2* on the second. The live check marks every defining line and names the other lines.
- Per line, qaflisp reports only one undefined symbol (`LDA Foo+Bar` → only *Undefined symbol 'Bar'*); the live check marks each.

### Misplaced labels and unknown mnemonics

- An indented label is read as a mnemonic: ` Start LDA #1` and `  Start` give *Illegal mnemonic*, and every use of `Start` then gives *Undefined symbol*. The same for a typo such as `LDAA`.
- A mnemonic in column 1 (`LDA #1` without indentation) is read as a label: *Illegal mnemonic*. A digit or `*` in column 1 gives *Illegal label*.
- Mnemonics are accepted in any case (`lda`).

### Wrong operands

| Example | qaflisp message |
|---|---|
| addressing mode the instruction does not have: `STA #5`, `CLR ,X+`, `ANDCC $20`, `JMP #5`, `BEQ 3,X`, `LEAX 3,Y` | *Illegal Addressing Mode* (`BEQ 3,X`: *Illegal addressing mode*) |
| register pair not allowed: `TFR A,X`, `EXG A,X` | *Illegal register combination* |
| missing operand: `LDA`, `LSL` | *Syntax Error* |
| malformed operand: `#5,X`, `,Z+`, `3,PC`, `A,SP`, `,X` (use `0,X`) | *Syntax Error* |
| `#` in a directive: `EQU #$FB`, `ORG #$00`, `FCB 2,#3`, `FCB -#1`, `RMB #2` | *Illegal character, Position[n]* (n = 0-based column of the `#`) |
| `#` before the string of `FCS`: `FCS #"AB"` | *Bad operand syntax* |
| `#` inside an instruction's operand: `LDA ##1`, `LDA #1+#2` / `LDA 2+#1` | *Illegal character* / *Syntax Error* |

`#` is accepted after `END` (`END #Start`), in strings and as a character constant (`'#'`). `FCS` ignores everything after the string (`FCS "ab",#0` gives no message).

A blank inside an `FCB` list ends the operand. If the list ends with `,` before the blank (`FCB 1,2, 3,4`, also `FCB 1,2,` at the end of the line), qaflisp reports *Unterminated expression, Position[n]*. Otherwise the rest is a comment and qaflisp assembles only the bytes before the blank, without any message: `FCB 1,2 3,4` and `FCB 1,2 ,3` both give just `01 02`. The live check warns when such a comment goes on with bytes (`,3` or `3,4` in number formats or character constants); comments such as `4 bytes` or `Start,3` stay unflagged.

`EXG` accepts both register orders. The live check reports the same lines with the allowed forms (`src/addressing.js`).

### Expressions

- Operators: `*` `/` `%` (modulo) bind stronger than `+` `-` `&` `|` `^` `<<` `>>` `&&` `||`. There are only these **two levels**, both evaluated left to right — unlike C: `2<<1+1` is 5, `6&3+1` is 3, `1|2&0` is 0, `3&&1*4` is 1, but `10-4/2` is 8 and `5&6/2` is 1. `&&` and `||` are logical (result 0 or 1: `5&&3` is 1).
- Unary `-`, `~` (bitwise not) and `!` (logical not: `!5` is 0, `!0` is 1) bind strongest; parentheses group. There is no unary `+` and no location counter `*`.
- `%` after an operand is modulo, otherwise the binary prefix: `7%3` is 1, `%11%%10` is 3 mod 2 = 1, `7%10` is 7.
- Arithmetic is 32-bit two's complement, like C: `-1/2` is 0, `-7%3` is −1, `-1>>1` is −1 (arithmetic shift). Values are truncated only when the byte is generated: `$FF+1-1` is `$FF`. `x/0` gives *Integer divide by zero* (also via constants: `K/Z` with `Z EQU 0`); `x%0` is 0 without a message.
- Negative values are stored in two's complement: `-1` gives `$FF`, `-128` gives `$80`.
- Register names `A`, `X`, `Y`, `SP`, `CC` (any case) are reserved: `FCB X+1` gives *Illegal use of reserved word*. `PC` is not reserved — `FCB PC` gives *Undefined symbol 'PC'*. Mnemonics are ordinary names (`FCB LDA`: *Undefined symbol 'LDA'*).
- Commas always separate `FCB` values, also inside parentheses: `FCB (1,2)` gives *Missing Parenthesis*.

Syntax errors and their messages (position = 0-based column):

| Example | qaflisp message |
|---|---|
| `2*(3`, `1+(2`, `(2,)`, `(2**3)`, `(&2)`, `(+5)` | *Missing Parenthesis* |
| `2(3)`, `K(2)`, `3()`, `(1)(2)` — a value followed by `(` | *Missing Parenthesis* (the position points to the `(`) |
| `2*3)`, `(2))`, `)1(` | *Unexpected Parenthesis* |
| `2+`, `K+`, `~`, `!`, `1<<`, `,1`, `1,,2`, `[1]`, `{1}` | *Unterminated expression* |
| `2**3`, `2+*3`, `&2`, `<<1`, `+5` | *Operand expected* |
| `'A''B'`, `K'A'`, `(1)'A'`, `(1)2` | *Missing operator* |
| `1=2`, `1.5`, `1:` | *Bad delimiter* |
| `1?2`, `1@`, `2'A'` | *Illegal decimal digit* |
| `1<2`, `1>2` | *Reached unreacheable point in Parser..P0* |
| in an instruction operand, e.g. `LDA 1+,X`, `JMP Start+` | *Syntax Error* |

Accepted without a message, probably by accident:
- A missing operand right before `)` counts as 0: `()` is 0, `(2+)` is 2, `2*()` is 0, `(~)` is `$FF`, `(-)` is 0.
- `~` or `!` after a value drops everything before it: `1~2` is `~2` (`$FD`), `4!0` is `!0` (1), `2+1!0` is 1.

The live check parses expressions the same way (`src/expression.js`): it reports the lines above as errors (with its own, more explicit messages) and the two accepted oddities as warnings; 47 measured expressions give the same bytes as qaflisp, and a probe with about 100 expressions gives exactly qaflisp's error lines.

### Where expressions can be used

| Place | Example | qaflisp |
|---|---|---|
| immediate data | `LDA #N*3+1`, `LDA #Table>>1`, `LDA #'A'+1`, `ANDCC #~1`, `ORCC #1<<4` | ✓ |
| absolute address | `LDA Table+2`, `STA BASE+N`, `JMP Start+1`, `JSR Loop&$FE` | ✓ |
| offset of indexed addressing | `LDA N-1,X`, `LDA Table-Start,Y`, `LDA 2*N,SP` | ✓ |
| branch target | `BRA Loop+2`, `BNE Start+(Loop-Start)/2` | ✓ the expression is the target address; qaflisp computes the displacement |
| `FCB` | `FCB N,N*2,BASE\|1,Table,Loop-Start,'Z'-'A'` | ✓ labels and label differences, also further down |
| `EQU` | `MASK EQU 1<<N-1`, `TOP EQU Table+N*2` | ✓ also with labels further down |
| `ORG` | `ORG BASE*2`, `ORG Table+$20` | ✓ with symbols defined **above** — see the pass-1 rules below |
| `RMB` | `RMB N*2`, `RMB End1-Start`, `RMB K` with `K EQU 2` further down | ✓ — see the pass-1 rules below |
| `END` | `END Start+0` | ✓ |
| `FCS` | `FCS "AB"+1` | ✗ everything after the string is ignored |
| `TFR`, `EXG` | `TFR A+0,X` | ✗ *Bad register pair* |
| location counter | `BRA *+2` | ✗ *Bad operand syntax* — there is no `*` |

**`ORG` and `RMB` are evaluated in pass 1**, where qaflisp does not know every value yet. Measured with 24 cases:

| Operand uses | `ORG` | `RMB` |
|---|---|---|
| a label above (`ORG Start+4`, `RMB End1-Start`, the own label) | ✓ | ✓ |
| a label further down (`RMB Later-Start`, `L0 RMB L1-L0`) | *Forward reference* | *Phase error between passes* at a later label, or *Undetermined size for reservation of storage* |
| an `EQU` constant further down with a plain value (`RMB K` … `K EQU 2`) | *Forward reference* | ✓ |
| an `EQU` constant that contains a label, even one above (`K EQU Start+4`, `K EQU End1-Start`, `K EQU (Start-$20)*2`) | *Phase error* | *Phase error* or *Undetermined size* |
| an `EQU` constant that uses a symbol defined after it (`K EQU M` … `M EQU 2`, warning *symbol 'M' is forward referenced*) | *Phase error* | *Phase error* or *Undetermined size* |

The results fit the assumption that qaflisp takes labels in `EQU` expressions as 0 in pass 1 (`(Start-$20)*2` becomes negative: *Undetermined size*). Two cases pass without a message only by chance: `K EQU Start-Start+2` (the labels cancel out) and `K EQU Later` above `ORG K` with `Later` right after it (circular; qaflisp resolves it to address 0). Using constants in `FCB`, immediate data and addresses is fine in all these cases, because those are only evaluated in pass 2.

The live check reports all cases of the table on the `ORG`/`RMB` line (the two chance cases too). After assembling, qaflisp's *Phase error* at the later label is explained with a link to that line.

### Values larger than a byte

qaflisp accepts a byte value from **−256 to 255**; anything outside gives *Value (0x…) is truncated* (an error, but the truncated low byte is still written to `.s19`/`.fmem`). This applies wherever a byte is generated: `FCB 256`, `FCB $1FF`, `FCB 200+100`, `FCB BIG` with `BIG EQU 70000`, `LDA #256`, `LDA $100`, offsets such as `LDA 300,X` and `LDA -257,X`, `FCB -257`. `RMB -1` gives *Undetermined size for reservation of storage*.

Not reported:
- Values from −129 down to −256 are taken as their low byte: `FCB -129` gives `$7F`, `FCB -256` gives `$00`, `LDA 200,X` gives offset `$C8` (= −56) — the signed range −128…127 is not checked.
- Addresses beyond `$FF`: `ORG $1234`, `ORG 300` and `ORG -1` silently use the low byte (`$34`, `$2C`, `$FF`); `RMB $1000` and code or data running past `$FF` wrap around to `$00` without a message.

The live check reports the same *truncated* errors where the value is known without assembling (numbers, expressions, `EQU` constants — not label addresses) and warns about `ORG` outside `$00`–`$FF`. Branch displacements (*Displacement (0x…) is out of range*) need label addresses and are left to qaflisp.

### Addresses

Measured with listings (`qaflisp -L`); the live check computes the same layout (`src/layout.js`), and `test/symbols-test.js` compares it line by line with the listing (also 1360 single-instruction probes and about 170 probe files during development: no difference).

- The location counter starts at `$00`; `ORG` sets it. It is **not wrapped** at `$FF`: a label after `ORG $F0` and `RMB $20` has the address `$110`. Only the bytes are written to the address modulo 256 (`$10`), without a message — the memory has 256 bytes.
- Every instruction variant has a fixed length (`src/instructions.js`, checked against qaflisp); there are no short and long forms.
- `FCB`: one byte per value. `FCS`: one byte per character, `\"` and `\n` count once, no terminating byte. Quirks: `FCS ""` gives *Bad operand syntax* but writes 2 bytes (`22 0A`); a string without closing quote gives *Bad operand syntax* and an extra newline byte (`"abc` → `61 62 63 0A`); `FCS #"AB"` writes nothing. `RMB n`: n bytes; `RMB 0` gives *Undetermined size for reservation of storage*.
- **Lines with errors**: a syntax error in an instruction (bad operand, addressing mode, register pair, invalid number, `#`, expression syntax) — and an unknown mnemonic, including `MOVE` and `CMJEQ` — occupies **0 bytes**. An undefined symbol, a value out of range or a division by zero keeps the normal length (the value written is 0 or the low byte). `FCB` writes the values before the first syntax error (`FCB 1,(2` → 1 byte, `FCB 2,#3` → 1 byte); a value followed by `=`, `.`, `:`, `<` or `>` is still written and ends the list (`FCB 1=2,3` → 1 byte, *Bad delimiter*). Quirk: `LDA 1<2` is assembled (2 bytes, *Reached unreacheable point in Parser..P0*), `LDA 1=2` is not.
- A line whose label is defined twice is not assembled (see below); after the resulting *Phase error*, qaflisp reports no further errors in the file.
- Branches: the displacement is counted from the next instruction and must be −128…+127 (*Displacement (0x…) is out of range*), computed with the unwrapped addresses. Using a label beyond `$FF` as a byte (`LDA U` with `U` at `$100`) gives *Value is truncated*.

The live check uses the layout for branch distances, values with labels (`FCB Start+300`), a warning where code or data first goes beyond `$FF`, and the hover (address of a label, value of a constant). It stops the layout at a multiple definition and at an `ORG`/`RMB` whose value qaflisp does not know in pass 1, so it does not guess addresses after them.

### Phase error between passes

qaflisp works in two passes: pass 1 assigns an address to every label, pass 2 generates the code. If a label ends up at a different address in pass 2, qaflisp reports *Phase error between passes* at that label. Two causes are known:

1. **Follow-up error of a multiple definition** (the usual case): qaflisp does not assemble a line whose label is defined more than once — its machine code is missing. All addresses after it shift, and the next label reports the phase error. Fixing the multiple definition removes it. Errors such as *Undefined symbol*, *Illegal mnemonic* or *Value … is truncated* do **not** cause phase errors, because those lines occupy the same space in both passes.
2. **A value that is not known in pass 1, used in `ORG` or `RMB`**: a label further down, an `EQU` that contains a label, or an `EQU` that uses a symbol defined after it (`K EQU M` before `M EQU 2`, warning *forward referenced*) — see "Where expressions can be used". A simple forward reference (`RMB N` before `N EQU 3`) works.

The extension adds this explanation to the message and links to the nearest multiple definition above it, or to the `ORG`/`RMB` line.

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

### `.fmem` commands in DigiFlisp

DigiFlisp loads `.fmem` files ("FLISP memory source"). Its program contains these command names, in lower case — so they are compared case-insensitively: `setmemory`, `setregister`, `clearallmemory`, `clearallregisters`. They are translated to internal commands (`wm<addr><data>` for memory; `wa`, `wx`, `wy`, `wp`, `ws`, `wc` for the registers A, X, Y, PC, SP, CC). Lines without `#` are ignored, which is why qaflisp's header lines do no harm.

Tested by hand with DigiFlisp 2.08 (FLISP Monitor, *Load memory from file*); DigiFlisp showed **no message** for any line:

| Line | Effect |
|---|---|
| `#setmemory 21=22`, `#SETMEMORY 22=33` | accepted — commands are case-insensitive |
| `#setMemory 23 = 44`, `#setMemory 24=5`, `#setMemory 27=99 ; comment` | accepted — blanks around `=`, one hex digit and text after the value are fine |
| `#setMemory 28=AA` then `#setMemory 28=BB` | `$28` = BB — the later line wins |
| `#setMemroy 25=66` (typo), `setMemory 26=77` (no `#`) | skipped silently |
| `#setMemory 2G=88` | **written to `$20`** — invalid hex digits are read as 0, overwriting another cell without a warning |
| `#setRegister A=A1`, `X B2`, `Y=C3`, `SP=D4`, `PC=20`, `CC=05` | no effect: afterwards all registers were 00 and CC = 10 (as after a reset) |

So `#setRegister` either has another, unknown syntax, or DigiFlisp resets the registers after loading. The check (`src/fmem.js`) flags typos, invalid hex digits and lines without `#` (all silently mishandled by DigiFlisp) and warns about `#setRegister`. `test/fmem-test.js` contains this hand test as a test case.

## The instruction table (`src/instructions.js`)

The table behind the hover and the mnemonic lists has one entry per mnemonic qaflisp accepts (84 instructions with 265 variants, plus 6 directives and 2 lab instructions). Its data comes from two sources:

| Data | Source | How it is checked |
|---|---|---|
| valid addressing modes, opcodes, lengths | measured with qaflisp 1.3: every mnemonic assembled with every addressing mode | `test/instructions-test.js` assembles every variant and compares opcode and length, and checks that every mode that is not listed is rejected |
| cycles | FLISP-Handbok, opcode map (p. 11) | cross-checked with the detail pages: 207 opcodes agree; the map shows `x` for `C5` (`ADCA n,X`), the detail page gives 5 |
| flags, operations, titles | FLISP-Handbok, detail pages (pp. 13–42), written in English | by hand |

Things to know when changing it:

- In the text extracted from the PDF, several detail pages (e.g. `CLR`, `ROL`, `ROR`, `ASL`, `PUL`) have their columns shifted, so variant, opcode and operation do not line up. The opcode map and qaflisp are reliable; the extracted detail pages are not.
- The extraction also loses the operator symbols ∧ ∨ ⊕ of the logical instructions; the table writes them out again.
- Aliases have identical opcodes: `ASL`/`ASLA` = `LSL`/`LSLA`, `PSHCC`/`PULCC` = `PSHC`/`PULC`, `BHS` = `BCC`, `BLO` = `BCS`.
- Flags: `LD…` sets N and Z, clears V; `ST…` changes no flags; only `PULC` and `RTI` (all flags from the stack) and `TFR`/`EXG` with CC as target change flags among the stack and transfer instructions; `ANDCC`/`ORCC`/`RTI`/`PULC` also affect the interrupt mask I.
- `EXG` accepts both register orders (`EXG X,Y` and `EXG Y,X`) with the same opcode.

## DigiFlisp and where qaflisp is installed

DigiFlisp 2.08 is available for Windows, Linux (x64, `.deb` and `.tar.gz`) and macOS (Intel and Apple silicon). Every package includes qaflisp:

| Platform | qaflisp location |
|---|---|
| Windows | `Program Files (x86)\GMV\DigiFlisp<n>\qaflisp.exe` — DigiFlisp itself expects qaflisp next to `digiflisp.exe` |
| Linux `.deb` | `/usr/share/digiflisp/qaflisp` (not on the `PATH`) |
| Linux `.tar.gz` | wherever it is unpacked; the install instructions use `/usr/bin` |
| macOS | `/Applications/Digiflisp.app/Contents/MacOS/qaflisp` |

The Linux x64 build prints the same messages and produces identical `.s19` and `.fmem` files as the Windows build (apart from the exit code, see above). The macOS builds have only been checked from the package contents (same message formats); feedback from macOS users is welcome.
