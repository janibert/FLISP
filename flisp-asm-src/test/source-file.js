// Reads a test source the way the extension sees it (shared by examples-test.js and probes-test.js):
// the bytes on disk give BOM, line endings and encoding (src/fileBytes.js); the text is what VS Code
// shows (a single-byte file decoded as Windows-1252, as after "Reopen with Encoding").

const fs = require('fs');
const { analyze } = require('../src/symbols');
const { inspectBytes, encodingFor, fileProblems } = require('../src/fileBytes');

const splitLines = (source) => source.split(/\r\n|\r|\n/); // the line breaks of VS Code

function readSource(file) {
  const bytes = fs.readFileSync(file);
  const info = inspectBytes(bytes);
  const encoding = encodingFor(info, 'utf8');
  const body = info.bom === 'utf8' ? bytes.subarray(3) : bytes;
  const source = new TextDecoder(encoding === 'utf8' ? 'utf-8' : 'windows-1252', { ignoreBOM: true }).decode(body);
  return { bytes, info, encoding, source };
}

// All live diagnostics: those of the file bytes (as for an unchanged document) and of the text.
function diagnosticsOf({ info, encoding, source }) {
  const lines = splitLines(source);
  const file = fileProblems(info, { dirty: false, lineLength: (l) => (lines[l] || '').length });
  return [...file, ...analyze(source, { encoding }).diagnostics];
}

// qaflisp counts a line break only at LF; a lone CR joins two editor lines. Returns a function
// from qaflisp's 1-based line number to the 0-based editor line where that line starts.
function editorLineOf({ info, source }) {
  const lone = new Set(info.loneCrLines);
  const start = [];
  let qaflispLine = 0;
  for (let line = 0; line < splitLines(source).length; line++) {
    if (start[qaflispLine] === undefined) start[qaflispLine] = line;
    if (!lone.has(line)) qaflispLine++;
  }
  return (n) => start[n - 1];
}

module.exports = { readSource, diagnosticsOf, editorLineOf, splitLines };
