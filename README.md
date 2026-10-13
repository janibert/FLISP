# FLISP Assembly for VS Code

A Visual Studio Code extension for the assembly language of the FLISP processor (FLexible Instruction Set Processor), the teaching processor used with the DigiFlisp simulator.

- **Syntax highlighting** for `.sflisp` source files and `.fmem` memory images
- **Assembling from the editor** with qaflisp (`F7` or the ▶ button): errors and warnings are underlined in the source and listed in the *Problems* panel
- Works with the `qaflisp` assembler of an installed [DigiFlisp](https://www.gbgmv.se/studies.html) on Windows, Linux and macOS

![A FLISP running-light program highlighted in VS Code](flisp-asm-src/images/running-light.png)

## Install

In VS Code, open the Extensions view (`Ctrl+Shift+X`), search for **FLISP Assembly** and click *Install* — or install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=janibert.flisp-asm).

## User Documentation

See the extension's README: [`flisp-asm-src/README.md`](flisp-asm-src/README.md).


## Building and Development

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the FLISP, qaflisp and DigiFlisp details the extension is built on.

Requires Node.js 20 or later. The extension lives in `flisp-asm-src/`; run all commands there. All paths below are relative to that folder.

```bash
cd flisp-asm-src
npm install          # fetches vsce and the test libraries
npm test             # unit tests for the qaflisp integration, then the grammar tests
npm run package      # creates flisp-asm-<version>.vsix
```

The `.vsix` ends up in the project folder. `.vscodeignore` keeps `test/` and `node_modules/` out of the package, and every `.exe` except `bin/qaflisp.exe`.

To develop without packaging: open the repository folder in VS Code and press `F5` (configuration *Run FLISP extension* in `.vscode/launch.json`). This launches a second VS Code window with the extension from `flisp-asm-src/` loaded and the `test/` folder open — open a `.sflisp` file there, e.g. `running-light.sflisp`, and check the highlighting directly.

### The tests

`test/qaflisp-test.js` tests the qaflisp integration (`src/qaflisp.js`) without VS Code: parsing of qaflisp's messages, the command-line flags and the search order. If a real `qaflisp.exe` is found above the project folder or on the `PATH`, it also assembles a correct and a broken file with it; otherwise those two cases are skipped.

`test/symbols-test.js` tests the symbol analysis (`src/symbols.js`) behind Go to Definition, references, outline, rename and the live check. If a real qaflisp is found, it also assembles probe files and checks that every line qaflisp reports as *Undefined symbol* or *Multiple definition* is reported by the live check as well, and that a file qaflisp accepts gives no live errors.

`test/tokenize-test.js` loads the grammar with the same engine VS Code uses (`vscode-textmate` plus `vscode-oniguruma`), tokenizes the sample files and, for each expectation, checks one specific token on one specific line. The cases are in the `expectations` list at the top of the script; adding one is a single line:

```js
// [file, unique snippet of the line, exact token text, scope prefix]
['sample.sflisp', 'CMPA    #2', 'CMPA', 'keyword.other.instruction'],
// '!' before the scope: the token must NOT have this scope
['sample.sflisp', 'BEQ     Start', 'Start', '!entity.name.function.label'],
```

`test/qaflisp-output.fmem` is real qaflisp output (deliberately not named `sample.fmem`, so that assembling the sample does not overwrite it). `test/sample.sflisp` assembles with qaflisp without errors, except for the lab instructions and the deliberately wrong line `LDA #1` in column 1.

### Inspecting scopes in the editor

If a colour looks wrong: `Ctrl+Shift+P` → *Developer: Inspect Editor Tokens and Scopes*, then put the cursor on the character in question. VS Code shows which scope applies there — that tells you which rule matched.

## Files

### Repository layout

```
CONTRIBUTING.md   how to contribute; FLISP / qaflisp / DigiFlisp domain knowledge
flisp-asm-src/    the extension (source, grammars, tests)
```

### Source Files

In `flisp-asm-src/`:

```
package.json                     metadata, file extensions, command, settings, build scripts
language-configuration.json      comment character, bracket pairs
syntaxes/flisp.tmLanguage.json   grammar for .sflisp
syntaxes/fmem.tmLanguage.json    grammar for .fmem
extension.js                     command, diagnostics, settings (VS Code side)
src/features.js                  definition, references, outline, hover, rename, live check (VS Code side)
src/symbols.js                   symbol analysis of a .sflisp file (no VS Code API)
src/mnemonics.js                 lists of mnemonics, directives and registers
src/qaflisp.js                   finding and running qaflisp, parsing its output
bin/qaflisp.exe                  bundled qaflisp 1.3 (GMV, see THIRD-PARTY-NOTICES.md)
images/icon.png                  logo (DigiFlisp icon, extracted from digiflisp.exe)
THIRD-PARTY-NOTICES.md           DigiFlisp license for qaflisp.exe and the icon
CHANGELOG.md                     release notes (shown on the Marketplace)
test/qaflisp-test.js             tests for src/qaflisp.js
test/symbols-test.js             tests for src/symbols.js
test/tokenize-test.js            scope test
test/sample.sflisp               sample code for the test
test/running-light.sflisp        example program (used for the screenshot)
test/qaflisp-output.fmem         qaflisp output for the test
.vscodeignore                    what stays out of the package
```

## Customizing

The grammar is in `syntaxes/flisp.tmLanguage.json`. A new custom instruction goes in three places:

1. in `statement-operand`, group 3 (`MOVE|CMJEQ`) — or in `statement-inherent` if it takes no operand,
2. in the list of the first `label` rule, so that it is flagged as an error in column 1,
3. in `src/mnemonics.js` (`LAB`, or `INHERENT` if it takes no operand), so that the symbol analysis knows it.

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
