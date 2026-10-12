# FLISP Assembly für VS Code

Syntax-Highlighting für die Assemblersprache des FLISP-Prozessors (FLexible Instruction Set Processor), wie er in den Grudat-Laborationen mit DigiFlisp verwendet wird.

Grundlage sind das *FLISP-Handbok* (Version 2025-12-09) und das Verhalten des Assemblers `qaflisp` (Version 1.3). Wo das Handbuch schweigt, gilt, was qaflisp tatsächlich annimmt.

## Was hervorgehoben wird

**`.sflisp` (Quelltext)**

| Element | Beispiel |
|---|---|
| Kommentare | `; Text bis Zeilenende` und alles nach dem Operand (siehe unten) |
| Labels | Name in Spalte 1, optional mit `:` |
| Assemblerdirektiven | `ORG`, `EQU`, `FCB`, `FCS`, `RMB`, `END` |
| Sprunginstruktionen | `JMP`, `JSR`, `BSR`, `BRA`, `RTS`, `RTI`, alle `B…`-Branches |
| übrige Instruktionen | der komplette Satz aus dem FLISP-Handbuch, dazu die Aliasse `ASLA`/`ASL`, `PSHCC`, `PULCC` |
| Laborinstruktionen | `MOVE`, `CMJEQ` — eigener Scope, *kursiv und unterstrichen* |
| Zahlen | `$3F` hex, `%01000000` binär, `42` dezimal, `'A'` Zeichen |
| Immediate | `#` |
| Register | `A`, `X`, `Y`, `SP`, `PC`, `CC` |
| Indizierte Adressierung | `n,SP` · `n,X` · `A,Y` · `,X+` · `,X-` · `,+Y` · `,-Y` |
| Strings | `"TEXT"` für `FCS` |
| Fehler | Mnemonic in Spalte 1 (qaflisp liest es als Label: *Illegal mnemonic*) |

**`.fmem` (Speicherabbild, von qaflisp erzeugt)** — `#setMemory`-Direktiven mit Adresse und Wert; `# ClearAllMemory` und `# ClearAllRegisters` mit eigener Hervorhebung (Scope `keyword.control.reset`); die Kopfzeilen erscheinen als Kommentar.

### Zeilenaufbau und Kommentare

qaflisp liest jede Zeile als `[Label] Mnemonic [Operand] [Kommentar]`:

- Spalte 1 ist immer ein Label. Ein Befehl muss eingerückt sein.
- Der Operand endet am ersten Leerzeichen (außer in einem String). Alles danach ist Kommentar, auch ohne `;`.
- Bei Befehlen ohne Operand (`NOP`, `PSHA`, `RTS`, `INCA` …) und bei `END` ist alles nach dem Mnemonic Kommentar.

Die Grammatik macht das genauso. Das hat eine praktische Folge: `LDA #K + 1` lädt `K`, nicht `K+1` — das ` + 1` ist Kommentar und wird grau dargestellt. Richtig ist `LDA #K+1`.

### Laborinstruktionen

`MOVE` und `CMJEQ` sind keine Standardbefehle; weder das Handbuch noch qaflisp kennen sie. Sie bekommen den Scope `entity.name.type.instruction.custom.flisp`. Die Extension setzt dafür per Default *kursiv und unterstrichen*, damit sie in jedem Theme auffallen.

Wenn du in deinen Einstellungen selbst `editor.tokenColorCustomizations.textMateRules` setzt, ersetzt das diese Vorgabe. Dann die Regel dort ergänzen:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "entity.name.type.instruction.custom.flisp", "settings": { "fontStyle": "italic underline" } }
  ]
}
```

## Installation

Ohne Marketplace, auf eine von zwei Arten:

**Als `.vsix`** — in VS Code `Strg+Shift+P` → *Extensions: Install from VSIX…* → Datei auswählen.

**Als Ordner** — den Ordner `flisp-asm-src` hierhin kopieren und VS Code neu starten:

- Windows: `%USERPROFILE%\.vscode\extensions\`
- macOS/Linux: `~/.vscode/extensions/`

Benötigt VS Code 1.63 oder neuer.

## Selbst bauen

Voraussetzung ist Node.js (Version 20 oder neuer).

```bash
npm install          # holt vsce und die Test-Bibliotheken
npm test             # prueft die Grammatik gegen test/sample.sflisp und test/sample.fmem
npm run package      # erzeugt flisp-asm-0.2.1.vsix
```

Die `.vsix` landet im Projektordner. `.vscodeignore` sorgt dafür, dass `test/` und `node_modules/` nicht mit ins Paket wandern.

Zum Entwickeln ohne Paketieren: den Ordner in VS Code öffnen und `F5` drücken. Das startet ein zweites VS-Code-Fenster mit geladener Extension — dort eine `.sflisp` öffnen und das Highlighting direkt ansehen.

### Der Test

`test/tokenize-test.js` lädt die Grammatik mit derselben Engine wie VS Code (`vscode-textmate` plus `vscode-oniguruma`), tokenisiert die Beispieldateien und prüft für jede Erwartung ein bestimmtes Token in einer bestimmten Zeile. Die Fälle stehen oben im Skript in der Liste `expectations`; ein neuer ist eine Zeile:

```js
// [Datei, eindeutiger Ausschnitt der Zeile, exakter Token-Text, Scope-Anfang]
['sample.sflisp', 'CMPA    #2', 'CMPA', 'keyword.operator.mnemonic'],
// '!' vor dem Scope: Das Token darf diesen Scope nicht haben
['sample.sflisp', 'BEQ     Start', 'Start', '!entity.name.function.label'],
```

`test/sample.fmem` ist echte qaflisp-Ausgabe. `test/sample.sflisp` assembliert mit qaflisp fehlerfrei, bis auf die Laborinstruktionen und die absichtlich falsche Zeile `LDA #1` in Spalte 1.

### Scopes im Editor nachsehen

Wenn eine Farbe nicht stimmt: `Strg+Shift+P` → *Developer: Inspect Editor Tokens and Scopes*, dann den Cursor auf das fragliche Zeichen setzen. VS Code zeigt, welcher Scope dort gilt — damit findest du die Regel, die gegriffen hat.

## Dateien

```
package.json                     Metadaten, Dateiendungen, Build-Skripte, Default-Stil fuer Laborinstruktionen
language-configuration.json      Kommentarzeichen, Klammerpaare
syntaxes/flisp.tmLanguage.json   die Grammatik fuer .sflisp
syntaxes/fmem.tmLanguage.json    die Grammatik fuer .fmem
images/icon.png                  Logo (DigiFlisp-Icon, aus digiflisp.exe extrahiert)
test/tokenize-test.js            Scope-Test
test/sample.sflisp               Beispielcode fuer den Test
test/sample.fmem                 qaflisp-Ausgabe fuer den Test
.vscodeignore                    was nicht ins Paket gehoert
```

## Anpassen

Die Grammatik liegt in `syntaxes/flisp.tmLanguage.json`. Eine neue eigene Instruktion trägst du an zwei Stellen ein:

1. in `statement-operand`, Gruppe 3 (`MOVE|CMJEQ`) — bzw. in `statement-inherent`, falls sie keinen Operand hat,
2. in die Liste der ersten `label`-Regel, damit sie in Spalte 1 als Fehler markiert wird.

Die Farben kommen vom aktiven VS-Code-Theme, nicht von der Extension. Je nach Theme sehen Direktiven und Instruktionen unterschiedlich aus. Instruktionen haben den Scope `keyword.other.instruction` und werden damit in praktisch jedem Theme eingefärbt; im Standard-Theme *Dark+* teilen sie sich allerdings die Farbe mit den Direktiven.

## Grenzen

Reines Highlighting — kein Assemblieren, keine Fehlerprüfung, keine Autovervollständigung, kein Debugger. Zum Assemblieren bleiben qaflisp bzw. DigiFlisp zuständig.

MIT-Lizenz, nutz es wie du magst.
