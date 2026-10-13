# FLISP Assembly for VS Code

Syntax highlighting and assembling for the assembly language of the FLISP processor (FLexible Instruction Set Processor), as used in the Grudat labs with DigiFlisp.

![A FLISP running-light program highlighted in VS Code](https://raw.githubusercontent.com/janibert/FLISP/main/flisp-asm-src/images/running-light.png)

*This extension is not affiliated with or endorsed by GMV (Göteborgs MikroVaror), the maker of DigiFlisp and qaflisp. The bundled `qaflisp.exe` and the DigiFlisp icon are used under the DigiFlisp software license — see [THIRD-PARTY-NOTICES.md](https://github.com/janibert/FLISP/blob/main/flisp-asm-src/THIRD-PARTY-NOTICES.md).*

The grammar follows the *FLISP-Handbok* and the `qaflisp` assembler.

## What gets highlighted

**`.sflisp` (source code)**

| Element | Example |
|---|---|
| Comments | `; text to end of line` and everything after the operand
| Labels | name in column 1, optionally followed by `:` |
| Symbols | labels and `EQU` constants used in an operand, e.g. `BRA Loop`, `STA LEDS` |
| Assembler directives | `ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END` — **bold** and in a different colour than instructions, so instructions for the assembler stand apart from instructions for the processor |
| Flow-control instructions | `JMP`, `JSR`, `BSR`, `BRA`, `RTS`, `RTI`, all `B…` branches |
| Other instructions | from the FLISP handbook, plus aliases `ASLA`/`ASL`, `PSHCC`, `PULCC` |
| Lab instructions | `MOVE`, `CMJEQ` — own scope, *italic and underlined* |
| Numbers | `$3F` hex, `%01000000` binary, `42` decimal, `'A'` character |
| Immediate | `#` — **bold**, because `LDA #5` (the value 5) and `LDA 5` (memory cell 5) are easy to confuse |
| Registers | `A`, `X`, `Y`, `SP`, `PC`, `CC` |
| Indexed addressing | `n,SP` · `n,X` · `A,Y` · `,X+` · `,X-` · `,+Y` · `,-Y` |
| Strings | `"TEXT"` for `FCS` |
| Errors | a mnemonic in column 1 (qaflisp reads it as a label: *Illegal mnemonic*) |

**`.fmem` (memory image)** — `#setMemory` directives with address and value;
`# ClearAllMemory` and `# ClearAllRegisters` with their own highlighting (scope `keyword.control.reset`); the header lines are shown as comments.

`.fmem` files are also checked while typing: unknown commands (with a hint for typos such as `#setMemroy`), addresses and values that are not 1–2 hex digits (`#setMemory 2G=05`), a missing `=` or value, a command without `#`, and an address that is set twice. DigiFlisp itself reports none of these: it skips unknown lines silently and reads invalid hex digits as 0 (`#setMemory 2G=88` writes to `$20`). `#setRegister` gets a warning, because it had no effect in DigiFlisp 2.08.

### Line structure and comments

qaflisp reads every line as `[Label] Mnemonic [Operand] [Comment]`:

- Column 1 is always a label. An instruction must be indented.
- The operand ends at the first space (except inside a string). Everything after it is a comment, even without `;`.
- For instructions without an operand (`NOP`, `PSHA`, `RTS`, `INCA` …), everything after the mnemonic is a comment.
- `END` takes an optional operand: the start symbol, e.g. `END Start`. It sets the start address in the `.s19` file (S9 record). Text after `END` is therefore *not* a comment unless it starts with `;` — `END Rest of line` makes qaflisp look for a symbol `Rest` and warn *start symbol 'Rest' is defined* (meaning: not defined).

The grammar does the same. This has a practical consequence: `LDA #K + 1` loads `K`, not `K+1` — the ` + 1` is a comment and is shown in grey. Write `LDA #K+1` instead.

### Lab instructions

`MOVE` and `CMJEQ` are not standard instructions; neither the handbook nor qaflisp knows them. They get the scope `entity.name.type.instruction.custom.flisp`, which the extension renders *italic and underlined* by default so they stand out.

## Labels and symbols

The extension knows every label and `EQU` constant in the file:

| Feature | How |
|---|---|
| Go to the definition | `F12` or `Ctrl`+click on a symbol, e.g. on `Loop` in `BRA Loop` |
| Find all uses | `Shift+F12`; clicking a symbol also highlights all its occurrences |
| Overview of all labels | *Outline* view, breadcrumbs, or `Ctrl+Shift+O` — code labels, data (`FCB`, `FCS`, `RMB`) and constants (`EQU`) have their own icons |
| Show the definition | hover over a symbol: its defining line and the number of uses |
| Rename | `F2` on a symbol renames its definition and every use |
| Check while typing | undefined symbols, labels defined twice, unknown mnemonics, labels that do not start in column 1, addressing modes an instruction does not have (`STA #5`), wrong register pairs (`TFR A,X`) and missing or malformed operands are underlined immediately, without assembling — with the allowed forms in the message |

The check works like qaflisp: **symbols are case-sensitive** (`Loop` and `loop` are different — the message suggests the other spelling), register names such as `X` cannot be symbols, and nothing after `END` counts. After assembling, qaflisp's own messages take the place of the live check on the same lines; editing a line removes the outdated qaflisp message there.

## Columns: Tab and formatting

FLISP code reads best as a table: label, mnemonic, operand, comment. The extension keeps these columns aligned (default: columns 0, 12, 20 and 36):

- **Tab** jumps to the next column, filling with blanks; **Shift+Tab** goes back to the previous one (removing the blanks before the cursor). With a selection, Tab indents as usual.
- **Format Document** (`Shift+Alt+F`) or *Format Selection* aligns all lines. Only blanks change, never the meaning: comments without `;` stay comments, strings stay untouched, and lines with a structural error (e.g. an indented label) are left as they are, so the live check can still point to them.
- Vertical **rulers** show the column borders; VS Code's indentation guides (useful for nested code, not for assembly) are switched off for FLISP. `.sflisp` files use blanks instead of tab characters.

To format on every save, add `"[flisp]": { "editor.formatOnSave": true }` to your settings. Other columns: set `flisp.columns` (and `editor.rulers` for `[flisp]` to match).

## Instruction reference on hover

Hover over a mnemonic to see what it does — tailored to the line you are on:

- what the instruction does, in the notation of the FLISP handbook (e.g. `Opr → A`),
- **this line**: the addressing mode used here, the exact operation (e.g. `LDA ,X+` → `M(X) → A; X + 1 → X`), opcode, length in bytes and clock cycles — or a hint if the instruction has no such addressing mode (e.g. `STA #5`),
- which flags are changed (N, Z, V, C — and I where it applies),
- a table of all variants with opcode, bytes and cycles; the one used on the line is highlighted.

Directives (`ORG`, `EQU`, `FCB`, …) and the lab instructions get a short explanation. Opcodes and lengths are checked against qaflisp; cycles and flags come from the FLISP handbook.

## Assembling

The extension runs the `qaflisp` assembler on the current file and shows its errors directly in the editor.

- **Run it:** the ▶ button in the editor title bar, `F7`, *FLISP: Assemble* in the command palette, or right-click a `.sflisp` file in the Explorer. Unsaved changes are saved first.
- **Errors and warnings** are underlined in the source and listed in the *Problems* panel. The full qaflisp output is in the *FLISP* output channel.
- **Output files** (`.s19`, `.lst`, `.fmem`) are written next to the source file. Load the `.fmem` into DigiFlisp.


`qaflisp` comes with [DigiFlisp](https://www.gbgmv.se/studies.html). The extension finds the qaflisp of an installed DigiFlisp automatically. On Windows it also works without DigiFlisp: a copy of `qaflisp.exe` is bundled with the extension.

| Platform | Status |
|---|---|
| Windows | tested |
| Linux x64 | qaflisp from DigiFlisp 2.08 checked: same messages and same output files as on Windows; the extension itself not yet tested on Linux |
| macOS | install location and message format checked in the DigiFlisp 2.08 packages; not tested on a Mac |

Feedback from Linux and macOS users is welcome — please open an issue.



### Settings

| Setting | Default | Meaning |
|---|---|---|
| `flisp.qaflispPath` | empty | path to `qaflisp.exe` |
| `flisp.assembleOnSave` | `false` | assemble automatically on every save |
| `flisp.listFile` | `true` | create a `.lst` list file (`-L`) |
| `flisp.warnings` | `true` | report warnings (`-w`) |
| `flisp.debugInfo` | `false` | generate source-level debug information (`-g`) |
| `flisp.columns` | `[12, 20, 36]` | start columns of mnemonic, operand and comment, for Tab and formatting |

Assembling runs an external program and is therefore disabled in [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust); highlighting works everywhere.

## Installation

**From the Marketplace** — in VS Code open the Extensions view (`Ctrl+Shift+X`), search for *FLISP Assembly* and click *Install*.

**As a `.vsix`** — in VS Code press `Ctrl+Shift+P` → *Extensions: Install from VSIX…* → select the file.

**As a folder** — copy the `flisp-asm-src` folder here and restart VS Code:

- Windows: `%USERPROFILE%\.vscode\extensions\`
- macOS/Linux: `~/.vscode/extensions/`

Requires VS Code 1.63 or later.

### Where qaflisp is looked for

1. the path in the `flisp.qaflispPath` setting — if set, nothing else is tried;
2. the source file's folder and its parent folders, up to the workspace folder;
3. the workspace folders;
4. the `PATH`;
5. the DigiFlisp installation folder:
   - Windows: `Program Files (x86)\GMV\DigiFlisp*` or `Program Files\GMV\DigiFlisp*`
   - Linux: `/usr/share/digiflisp` (the `.deb` package); the `.tar.gz` instructions install to `/usr/bin`, which is on the `PATH`
   - macOS: `/Applications/Digiflisp.app/Contents/MacOS` or `~/Applications/Digiflisp.app/Contents/MacOS`
6. on Windows, the copy bundled with the extension (qaflisp 1.3).

So a newer qaflisp in your workspace, on the `PATH` or next to DigiFlisp always takes precedence over the bundled one. The *FLISP* output channel shows which `qaflisp.exe` was used. If none is found, a message offers to pick it with a file dialog.


## Limitations

No autocompletion and no debugger. While you type, symbols, the line structure and the addressing modes are checked; other errors, such as values out of range or branch targets too far away, are found when you assemble. Labels and symbols work within one file. On Linux and macOS, assembling needs an installed DigiFlisp (or another qaflisp). Use DigiFlisp to run and debug the program.

## License

The extension's own files are MIT-licensed, © 2026 Jan Ebert — see [LICENSE](https://github.com/janibert/FLISP/blob/main/flisp-asm-src/LICENSE). The bundled `qaflisp.exe` and the DigiFlisp icon belong to GMV and are distributed under the DigiFlisp software license — see [THIRD-PARTY-NOTICES.md](https://github.com/janibert/FLISP/blob/main/flisp-asm-src/THIRD-PARTY-NOTICES.md).
