# FLISP Assembly for VS Code

Write, check and assemble programs for the FLISP processor (FLexible Instruction Set Processor), as used in the Grudat labs with DigiFlisp.

![A FLISP running-light program highlighted in VS Code; the hover over Count shows its address](https://raw.githubusercontent.com/janibert/FLISP/main/flisp-asm-src/images/running-light.png)

## Quick start

1. Open a `.sflisp` file.
2. Press `F7` (or the ▶ button in the editor title bar) to assemble it with qaflisp.
3. Errors appear in the code and in the *Problems* panel; the `.fmem` file is written next to the source.

Install [DigiFlisp](https://www.gbgmv.se/studies.html) first, the extension finds its `qaflisp` automatically. Upload the generated `.fmem` files into the FLISP Computer to execute your program.

## Features

- **Checks while you type** — most mistakes are underlined before you assemble: wrong addressing modes, undefined labels, numbers like `0a`, branches that are too far, values that do not fit in a byte. You also get a warning where qaflisp accepts the code **without a message** but probably does something else than you meant, e.g. `ASLA Data` or `FCB 1,2 3,4`.
- **Hover** — over an instruction: what it does on this line, opcode, bytes, cycles and flags. Over a label or constant: its address or value in hex, decimal and binary.
- **Highlighting** — instructions, directives, labels, numbers and comments as qaflisp reads them; `#` and directives in bold.
- **Labels** — go to definition (`F12`), find all uses, outline, rename (`F2`).
- **Suggestions and columns** — suggestions that fit the column; Tab jumps to the next column; *Format Document* aligns the code.
- **`.fmem` files** — highlighting and a check for mistakes that DigiFlisp ignores silently.

![Typical mistakes underlined while typing: four errors in red, one warning in yellow](https://raw.githubusercontent.com/janibert/FLISP/main/flisp-asm-src/images/live-check.png)

![Hover over an instruction: operation, opcode, bytes, cycles, flags and all variants](https://raw.githubusercontent.com/janibert/FLISP/main/flisp-asm-src/images/hover-instruction.png)

## More

- **[User guide](https://github.com/janibert/FLISP/blob/main/docs/user-guide.md)** — every check with examples, all features, settings, where `qaflisp` is looked for.
- **[Examples to try](https://github.com/janibert/FLISP/tree/main/flisp-asm-src/test/examples)** — small files, one topic each; every line says what the extension reports.
- **Settings** — Extensions view → *FLISP Assembly* → *Features*.
- Questions and bugs: [GitHub issues](https://github.com/janibert/FLISP/issues).

## License

The extension's own files are MIT-licensed, © 2026 Jan Ebert — see [LICENSE](https://github.com/janibert/FLISP/blob/main/flisp-asm-src/LICENSE).

*This extension is not affiliated with or endorsed by GMV (Göteborgs MikroVaror), the maker of DigiFlisp and qaflisp. The bundled `qaflisp.exe` and the DigiFlisp icon belong to GMV and are used under the DigiFlisp software license — see [THIRD-PARTY-NOTICES.md](https://github.com/janibert/FLISP/blob/main/flisp-asm-src/THIRD-PARTY-NOTICES.md).*
