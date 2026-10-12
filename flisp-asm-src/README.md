# FLISP Assembly für VS Code

Syntax-Highlighting für die Assemblersprache des FLISP-Prozessors (FLexible Instruction Set Processor), wie er in den Grudat-Laborationen mit DigiFlisp verwendet wird.

## Was hervorgehoben wird

**`.sflisp` (Quelltext)**

| Element | Beispiel |
|---|---|
| Kommentare | `; Text bis Zeilenende` |
| Labels | `L1:` oder ein Name in Spalte 1 |
| Assemblerdirektiven | `ORG`, `EQU`, `FCB`, `FCS`, `RMB` |
| Sprunginstruktionen | `JMP`, `JSR`, `BSR`, `BRA`, `RTS`, `RTI`, alle `B…`-Branches |
| übrige Instruktionen | der komplette Satz aus dem FLISP-Handbuch |
| Laborinstruktionen | `MOVE`, `CMJEQ` (eigene Hervorhebung) |
| Zahlen | `$3F` hex, `%01000000` binär, `42` dezimal |
| Immediate | `#` |
| Register | `A`, `X`, `Y`, `SP`, `PC`, `CC` |
| Indizierte Adressierung | `n,X` · `A,Y` · `,X+` · `,-Y` |
| Strings | `"TEXT"` für `FCS` |

**`.fmem` (Speicherabbild)** — `#setMemory`-Direktiven mit Adresse und Wert.

## Installation

Ohne Marketplace, auf eine von zwei Arten:

**Als `.vsix`** — in VS Code `Strg+Shift+P` → *Extensions: Install from VSIX…* → Datei auswählen.

**Als Ordner** — den Ordner `flisp-asm` hierhin kopieren und VS Code neu starten:

- Windows: `%USERPROFILE%\.vscode\extensions\`
- macOS/Linux: `~/.vscode/extensions/`

## Selbst bauen

Voraussetzung ist Node.js (Version 20 oder neuer).

```bash
npm install          # holt vsce und die Test-Bibliotheken
npm test             # prueft die Grammatik gegen test/sample.sflisp
npm run package      # erzeugt flisp-asm-0.1.0.vsix
```

Die `.vsix` landet im Projektordner. `.vscodeignore` sorgt dafür, dass `test/` und `node_modules/` nicht mit ins Paket wandern.

Zum Entwickeln ohne Paketieren: den Ordner in VS Code öffnen und `F5` drücken. Das startet ein zweites VS-Code-Fenster mit geladener Extension — dort eine `.sflisp` öffnen und das Highlighting direkt ansehen.

### Der Test

`test/tokenize-test.js` lädt die Grammatik mit derselben Engine wie VS Code (`vscode-textmate` plus `vscode-oniguruma`), tokenisiert `test/sample.sflisp` und prüft, ob jedes erwartete Element den richtigen Scope bekommt. Die Fälle stehen oben im Skript in der Liste `expectations`; ein neuer ist eine Zeile:

```js
['sample.sflisp', 'ADDA', 'keyword.operator.mnemonic'],
```

Der Test hat beim Bauen einen echten Fehler gefunden: Die erste Fassung der Label-Regel hat jedes eingerückte Mnemonic als Label eingefärbt. Wenn du an der Grammatik schraubst, lass ihn mitlaufen.

### Scopes im Editor nachsehen

Wenn eine Farbe nicht stimmt: `Strg+Shift+P` → *Developer: Inspect Editor Tokens and Scopes*, dann den Cursor auf das fragliche Zeichen setzen. VS Code zeigt, welcher Scope dort gilt — damit findest du die Regel, die gegriffen hat.

## Dateien

```
package.json                     Metadaten, Dateiendungen, Build-Skripte
language-configuration.json      Kommentarzeichen, Klammerpaare
syntaxes/flisp.tmLanguage.json   die Grammatik fuer .sflisp
syntaxes/fmem.tmLanguage.json    die Grammatik fuer .fmem
test/tokenize-test.js            Scope-Test
test/sample.sflisp               Beispielcode fuer den Test
.vscodeignore                    was nicht ins Paket gehoert
```

## Anpassen

Die Grammatik liegt in `syntaxes/flisp.tmLanguage.json`. Wenn im Kurs weitere eigene Instruktionen dazukommen, trägst du sie in `custom-instruction` ein — und zusätzlich in die Ausschlussliste der `label`-Regel, damit sie am Zeilenanfang nicht als Label gelesen werden.

Die Farben kommen vom aktiven VS-Code-Theme, nicht von der Extension. Je nach Theme sehen Direktiven und Instruktionen unterschiedlich aus.

## Grenzen

Reines Highlighting — kein Assemblieren, keine Fehlerprüfung, keine Autovervollständigung, kein Debugger. Zum Assemblieren bleibt DigiFlisp zuständig.

MIT-Lizenz, nutz es wie du magst.
