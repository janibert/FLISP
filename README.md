# FLISP Assembly for VS Code

A Visual Studio Code extension for the assembly language of the FLISP processor (FLexible Instruction Set Processor), the teaching processor used with the DigiFlisp simulator.

- **Syntax highlighting** for `.sflisp` source files and `.fmem` memory images, following the *FLISP-Handbok* and the behaviour of the `qaflisp` assembler
- **Assembling from the editor** with qaflisp (`F7` or the ▶ button): errors and warnings are underlined in the source and listed in the *Problems* panel
- Works with the qaflisp of an installed [DigiFlisp](https://www.gbgmv.se/studies.html) on Windows, Linux and macOS; on Windows a copy of qaflisp is bundled

## Install

In VS Code, open the Extensions view (`Ctrl+Shift+X`), search for **FLISP Assembly** and click *Install* — or install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=janibert.flisp-asm).

## Documentation

Everything else — what is highlighted, how qaflisp is found, settings, building and testing — is in the extension's README: [`flisp-asm-src/README.md`](flisp-asm-src/README.md).

## Repository layout

```
flisp-asm-src/    the extension (source, grammars, tests)
```

## License

The extension's own code is MIT-licensed, © 2026 Jan Ebert — see [`LICENSE`](LICENSE).
The bundled `qaflisp.exe` and the DigiFlisp icon belong to GMV (Göteborgs MikroVaror) and are distributed under the DigiFlisp software license — see [`flisp-asm-src/THIRD-PARTY-NOTICES.md`](flisp-asm-src/THIRD-PARTY-NOTICES.md).

This project is not affiliated with or endorsed by GMV.
