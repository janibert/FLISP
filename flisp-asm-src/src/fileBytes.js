// What VS Code hides but qaflisp reads: the bytes of a source file (no VS Code API).
// Measured with qaflisp 1.3 (Windows and Linux builds behave the same, see CONTRIBUTING.md):
//   - a UTF-8 byte order mark is read as part of line 1 ("Illegal mnemonic", the line is lost)
//   - only LF and CRLF end a line; a lone CR does not, so the next line becomes part of this one
//     (VS Code shows a line break there, and saving with Ctrl+S writes uniform line endings)
//   - strings are written byte by byte, so their size depends on the encoding (src/layout.js)

// { bom: 'utf8' | 'utf16le' | 'utf16be' | undefined,
//   encoding: 'utf8' | 'singleByte' | undefined (undefined: only ASCII, the bytes do not tell),
//   loneCrLines: lines (numbered as in VS Code) that end with a CR without LF, crOnly: no LF at all }
function inspectBytes(bytes) {
  let bom;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bom = 'utf8';
  else if (bytes[0] === 0xFF && bytes[1] === 0xFE) bom = 'utf16le';
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) bom = 'utf16be';
  if (bom && bom !== 'utf8') return { bom, encoding: undefined, loneCrLines: [], crOnly: false };

  const loneCrLines = [];
  let line = 0;
  let lf = 0;
  let nonAscii = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0A) {
      line++;
      lf++;
    } else if (b === 0x0D) {
      if (bytes[i + 1] === 0x0A) continue; // CRLF: counted at the LF
      loneCrLines.push(line);
      line++;
    } else if (b >= 0x80) {
      nonAscii = true;
    }
  }
  let encoding;
  if (nonAscii) encoding = isUtf8(bytes) ? 'utf8' : 'singleByte';
  else if (bom) encoding = 'utf8';
  return { bom, encoding, loneCrLines, crOnly: lf === 0 && loneCrLines.length > 0 };
}

function isUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch (e) {
    return false;
  }
}

// The encoding for the live check: from the bytes if they tell, otherwise the encoding VS Code
// will save with (setting files.encoding, e.g. 'utf8', 'utf8bom', 'windows1252', 'iso88591').
function encodingFor(info, filesEncoding) {
  if (info && info.encoding) return info.encoding;
  return /^utf(8|16)/.test(filesEncoding || 'utf8') ? 'utf8' : 'singleByte';
}

const MAX_LONE_CR_MESSAGES = 10;

// Diagnostics for what qaflisp reads differently. lineLength(line) gives the length of a line in
// the editor. Line-ending messages describe the file on disk, so they are given only while the
// document is unchanged (dirty: false).
function fileProblems(info, { dirty, lineLength }) {
  const found = [];
  const at = (line, severity, kind, message) => ({ line, start: 0, end: Math.max(lineLength(line), 1), severity, kind, message });
  if (info.bom === 'utf16le' || info.bom === 'utf16be') {
    found.push(at(0, 'error', 'utf16', 'The file is saved as UTF-16 — qaflisp cannot read it. Save it as UTF-8: click the encoding in the status bar, then "Save with Encoding" → "UTF-8"'));
    return found;
  }
  if (info.bom === 'utf8') {
    found.push(at(0, 'error', 'bom', 'The file starts with an invisible byte order mark (UTF-8 with BOM) — qaflisp reads it as part of line 1 ("Illegal mnemonic") and loses this line. Save it without BOM: click "UTF-8 with BOM" in the status bar, then "Save with Encoding" → "UTF-8"'));
  }
  if (dirty) return found;
  if (info.crOnly) {
    found.push(at(0, 'warning', 'crLineEnds', 'The lines of this file end with CR only (old Mac format) — qaflisp sees one single line and assembles almost nothing. Press Ctrl+S: VS Code saves the file with uniform line endings'));
  } else {
    for (const line of info.loneCrLines.slice(0, MAX_LONE_CR_MESSAGES)) {
      found.push(at(line, 'warning', 'loneCr', 'This line ends with CR only — qaflisp sees no line break here, reads the next line as part of this one, and its line numbers are shifted from here on. Press Ctrl+S: VS Code saves the file with uniform line endings'));
    }
  }
  return found;
}

module.exports = { inspectBytes, encodingFor, fileProblems };
