# FLISP Assembly for VS Code

A Visual Studio Code extension for the assembly language of the FLISP processor (FLexible Instruction Set Processor), the teaching processor used with the DigiFlisp simulator.

- **Syntax highlighting** for `.sflisp` source files and `.fmem` memory images
- **Assembling from the editor** with qaflisp (`F7` or the ▶ button): errors and warnings are underlined in the source and listed in the *Problems* panel
- **Checks while typing** that find qaflisp's errors before assembling — and warn where qaflisp silently accepts code that probably does something else than meant
- **Hover** for instructions (operation, opcode, cycles, flags) and for labels and constants (address, value)
- Works with the `qaflisp` assembler of an installed [DigiFlisp](https://www.gbgmv.se/studies.html) on Windows, Linux and macOS

![A FLISP running-light program highlighted in VS Code](flisp-asm-src/images/running-light.png)

## Install

In VS Code, open the Extensions view (`Ctrl+Shift+X`), search for **FLISP Assembly** and click *Install* — or install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=janibert.flisp-asm).

## User Documentation

- **[User guide](docs/user-guide.md)** — all features and every check with examples.
- **[Examples](flisp-asm-src/test/examples)** — small files to try the checks in the editor.
- The Marketplace page ([`flisp-asm-src/README.md`](flisp-asm-src/README.md)) is a short summary. Keep it short; new details go into the user guide.


## Building and Development

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the FLISP, qaflisp and DigiFlisp details the extension is built on.

Requires Node.js 20 or later. The extension lives in `flisp-asm-src/`; run all commands there. All paths below are relative to that folder.

```bash
cd flisp-asm-src
npm install          # fetches vsce and the test libraries
npm run build:grammar  # generates syntaxes/flisp.tmLanguage.json from the template and src/instructions.js
npm test             # all tests: grammar up to date?, qaflisp integration, live check, snapshot, grammar
npm run test:update-snapshot  # after an intended change of messages or addresses (see below)
npm run test:vscode  # tests inside the installed VS Code (opens a window for a few seconds)
npm run test:wsl     # on Windows: all of the above on Linux, in WSL (see below)
npm run package      # creates flisp-asm-<version>.vsix (regenerates the grammar first)
```

The `.vsix` ends up in the project folder. `.vscodeignore` keeps `test/`, `scripts/`, the grammar template and `node_modules/` out of the package, and every `.exe` except `bin/qaflisp.exe`.

**The `.sflisp` grammar is generated.** Edit `syntaxes/flisp.tmLanguage.template.json` (structure, scopes) or `src/instructions.js` (instruction set, directives, lab instructions), never `syntaxes/flisp.tmLanguage.json` directly; then run `npm run build:grammar`. `npm test` fails if the generated grammar is out of date.

To develop without packaging: open the repository folder in VS Code and press `F5` (configuration *Run FLISP extension* in `.vscode/launch.json`). This launches a second VS Code window with the extension from `flisp-asm-src/` loaded and the `test/` folder open — open a `.sflisp` file there, e.g. `running-light.sflisp`, and check the highlighting directly.

### The tests

`test/qaflisp-test.js` tests the qaflisp integration (`src/qaflisp.js`) without VS Code: parsing of qaflisp's messages, the command-line flags and the search order. If a real `qaflisp.exe` is found above the project folder or on the `PATH`, it also assembles a correct and a broken file with it; otherwise those two cases are skipped.

`test/symbols-test.js` tests the symbol analysis (`src/symbols.js`) behind Go to Definition, references, outline and rename: splitting lines, definitions, references, undefined and multiple symbols, `symbolAt`, `checkNewName`.

`test/checks-test.js` tests the live checks (`src/checks.js`, `src/expression.js`): line structure, `#`, numbers, FCB lists, values, expressions, ORG/RMB in qaflisp's first pass and the phase-error explanation. If a real qaflisp is found, it also assembles the probe sources in `test/check-probes.js` and checks that every line qaflisp reports as an error (undefined symbols, multiple definitions, addressing modes, expressions, numbers, value ranges, branch distances, …) is reported by the live check as well — for most probes exactly the same lines — and that a file qaflisp accepts gives no live errors.

`test/layout-test.js` tests the address layout (`src/layout.js`) and the checks that need it (branch distance, values with labels, beyond `$FF`). If qaflisp is found, it compares the computed address and length of every line with qaflisp's listing.

`test/examples-test.js` checks the files in `test/examples/`: every code line ends with a comment `; OK`, `; ERROR` or `; WARNING`, and the live check must report exactly that. If qaflisp is found, it must report an error on exactly the `ERROR` lines (the few lines where qaflisp stays silent on purpose are listed in the test). The examples are meant for trying the live check in the editor; each file starts with suggestions what to change.

`test/probes-test.js` is the regression net. `test/probes/` holds about 160 small probe files written while measuring qaflisp (file names start with the topic: `pass1-`, `phase-`, `sym-`, `expr-` …). For them and for all other `.sflisp` fixtures, `test/probes/expected.json` stores every live-check message and the computed address and length of every line; any change of behaviour fails the test. After an intended change, look at the reported differences and update the snapshot with `npm run test:update-snapshot` — commit `expected.json` together with the change. If qaflisp is found, the test also compares the layout of every file with qaflisp's listing, checks that every error qaflisp reports is reported by the live check (except *Phase error* and the lab instructions) and that the live check reports no error where qaflisp has none (except first-pass errors shown at their cause, multiple definitions marked on every defining line, and lines after a *Phase error*), and assembles one file with every mnemonic and every operand form.

`test/instructions-test.js` checks the instruction table (`src/instructions.js`) and the hover text. If a real qaflisp is found, it assembles every listed variant and compares opcode and length, and it checks that qaflisp rejects every addressing mode that is not listed — so the table is complete and has nothing extra.

`test/tokenize-test.js` loads the grammar with the same engine VS Code uses (`vscode-textmate` plus `vscode-oniguruma`), tokenizes the sample files and, for each expectation, checks one specific token on one specific line. The cases are in the `expectations` list at the top of the script; adding one is a single line:

```js
// [file, unique snippet of the line, exact token text, scope prefix]
['sample.sflisp', 'CMPA    #2', 'CMPA', 'keyword.other.instruction'],
// '!' before the scope: the token must NOT have this scope
['sample.sflisp', 'BEQ     Start', 'Start', '!entity.name.function.label'],
```

`test/vscode/suite.js` runs inside a real VS Code and is not part of `npm test`: `npm run test:vscode` (`test/vscode/run.js`) starts the installed VS Code with the extension from this folder, a temporary workspace and empty user settings, runs the suite and closes VS Code again. It checks live diagnostics and how they follow an edit, hover, definition, references, outline, rename, and the assemble command: qaflisp's messages become diagnostics, the live check steps back on their lines, and editing a line drops its outdated qaflisp message (skipped if no qaflisp is found). VS Code is found through the `code` command on the `PATH`; otherwise set `VSCODE_EXECUTABLE` to its executable.

`npm run test:wsl` (on Windows) runs `npm test` and the VS Code tests on Linux in WSL, with the Linux qaflisp and a Linux VS Code: `npm run test:wsl -- Ubuntu-24.04` picks the distribution (or set `FLISP_WSL_DISTRO`), otherwise the default one is used. On Linux itself run `bash test/wsl/run.sh`. No sudo is needed in WSL: unpack the official tarballs of Node.js into `~/tools/node`, of VS Code into `~/tools/vscode`, and DigiFlisp for Linux into `~/digiflisp` (or use installed ones on the `PATH`). WSLg shows the VS Code window; without a VS Code only the host tests are skipped.

`test/qaflisp-output.fmem` is real qaflisp output (deliberately not named `sample.fmem`, so that assembling the sample does not overwrite it). `test/sample.sflisp` assembles with qaflisp without errors, except for the lab instructions and the deliberately wrong line `LDA #1` in column 1.

### Inspecting scopes in the editor

If a colour looks wrong: `Ctrl+Shift+P` → *Developer: Inspect Editor Tokens and Scopes*, then put the cursor on the character in question. VS Code shows which scope applies there — that tells you which rule matched.

## Files

### Repository layout

```
README.md            this page (developer documentation)
CONTRIBUTING.md      how to contribute; FLISP / qaflisp / DigiFlisp domain knowledge
LICENSE              MIT license of the extension's own code
docs/user-guide.md   the complete user documentation (linked from the Marketplace page)
flisp-asm-src/       the extension (source, grammars, tests); its README.md is the short Marketplace page
.vscode/launch.json  F5 configuration "Run FLISP extension"
```

### Source Files

In `flisp-asm-src/`:

```
package.json                     metadata, file extensions, command, settings, build scripts
language-configuration.json      comment character, bracket pairs
syntaxes/flisp.tmLanguage.template.json  grammar template for .sflisp (edit this)
syntaxes/flisp.tmLanguage.json   grammar for .sflisp (generated, do not edit)
syntaxes/fmem.tmLanguage.json    grammar for .fmem
scripts/build-grammar.js         inserts the mnemonic lists into the template
extension.js                     command, diagnostics, settings (VS Code side)
src/features.js                  definition, references, outline, hover, rename, live check (VS Code side)
src/symbols.js                   parsing lines, definitions and references of a .sflisp file (no VS Code API)
src/checks.js                    the live checks and their order; phase-error explanation (no VS Code API)
src/instructions.js              instruction set: variants, opcodes, bytes, cycles, flags, operations;
                                 directives and lab instructions (single source)
src/mnemonics.js                 mnemonic lists derived from src/instructions.js, register names
src/instructionHover.js          hover text for mnemonics and directives (no VS Code API)
src/addressing.js                addressing mode of an operand, operand check (no VS Code API)
src/expression.js                reading and evaluating operand expressions like qaflisp (no VS Code API)
src/layout.js                    addresses of all lines, computed like qaflisp (no VS Code API)
src/fmem.js                      syntax check for .fmem files (no VS Code API)
src/fileBytes.js                 BOM, line endings and encoding of the file on disk (no VS Code API)
src/format.js                    column layout: tab stops and formatter (no VS Code API)
src/completion.js                context-sensitive suggestions (no VS Code API)
src/qaflisp.js                   finding and running qaflisp, parsing its output
bin/qaflisp.exe                  bundled qaflisp 1.3 (GMV, see THIRD-PARTY-NOTICES.md)
images/icon.png                  logo (DigiFlisp icon, extracted from digiflisp.exe)
THIRD-PARTY-NOTICES.md           DigiFlisp license for qaflisp.exe and the icon
CHANGELOG.md                     release notes (shown on the Marketplace)
test/qaflisp-test.js             tests for src/qaflisp.js
test/symbols-test.js             tests for src/symbols.js
test/checks-test.js              tests for the live checks (src/checks.js, src/expression.js); errors compared with qaflisp
test/layout-test.js              tests for src/layout.js; addresses compared with qaflisp's listing
test/check-probes.js             probe sources shared by checks-test.js and layout-test.js
test/instructions-test.js        tests for the instruction table and the hover
test/fmem-test.js                tests for src/fmem.js
test/fileBytes-test.js           tests for src/fileBytes.js; BOM and lone CR compared with qaflisp
test/format-test.js              tests for src/format.js, incl. same machine code before/after formatting
test/completion-test.js          tests for src/completion.js
test/examples-test.js            checks the OK / ERROR / WARNING comments in test/examples/ (live check and qaflisp)
test/probes-test.js              snapshot of all messages and addresses; layout and errors compared with qaflisp
test/tokenize-test.js            scope test
test/vscode/run.js, suite.js     tests inside the installed VS Code (npm run test:vscode)
test/wsl/run.js, run.sh          all tests on Linux in WSL (npm run test:wsl)
test/sample.sflisp               sample code for the test
test/examples/                   examples to try the live check in the editor, one topic per file
test/probes/                     probe files from measuring qaflisp; expected.json = snapshot for probes-test.js
test/invalid-numbers.sflisp      numbers that do not fit their base, for the scope test
test/running-light.sflisp        example program (used for the screenshot)
test/qaflisp-output.fmem         qaflisp output for the test
.vscodeignore                    what stays out of the package
```

## Customizing

A new custom instruction goes in one place: the object `LAB` in `src/instructions.js`, with a short description for the hover. Then run `npm run build:grammar`. The grammar, the column-1 check, the symbol analysis and the hover all use this table.

Colours come from the active VS Code theme, not from the extension. The scopes are chosen so that the default themes (2026 Dark/Light, Dark/Light Modern) give each element its own colour. In particular, directives (`support.type.directive`) and instructions (`keyword.other.instruction`) must never share a scope family — students should see at a glance what is an instruction for the assembler and what is an instruction for the processor. The test suite checks this.

### Default font styles

The extension sets three font styles via `configurationDefaults` in `package.json`, so they work in every theme:

- directives `ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END`: **bold**
- the immediate marker `#` (`LDA #5` loads the value 5, `LDA 5` the memory cell 5): **bold**
- lab instructions `MOVE`, `CMJEQ`: *italic and underlined*

Colours of other operators and punctuation (`,` `+` `-`) are left to the theme, as in other languages.

If you set `editor.tokenColorCustomizations.textMateRules` in your own settings, that replaces these defaults. In that case, add the rules there:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "support.type.directive.flisp", "settings": { "fontStyle": "bold" } },
    { "scope": "keyword.operator.immediate.flisp", "settings": { "fontStyle": "bold" } },
    { "scope": "entity.name.type.instruction.custom.flisp", "settings": { "fontStyle": "italic underline" } }
  ]
}
```

## License

The extension's own code is MIT-licensed, © 2026 Jan Ebert — see [`LICENSE`](LICENSE).
The bundled `qaflisp.exe` and the DigiFlisp icon belong to GMV (Göteborgs MikroVaror) and are distributed under the DigiFlisp software license — see [`flisp-asm-src/THIRD-PARTY-NOTICES.md`](flisp-asm-src/THIRD-PARTY-NOTICES.md).

This project is not affiliated with or endorsed by GMV.
