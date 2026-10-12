// Everything about running qaflisp that does not need the VS Code API,
// so it can be tested with plain Node (see test/qaflisp-test.js).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXE_NAMES = process.platform === 'win32' ? ['qaflisp.exe'] : ['qaflisp', 'qaflisp.exe'];

// Messages as printed by qaflisp 1.3:
//   <file> (<line>) Error: <text>[, Position[<col>]]
//   <file> (<line>) Warning: <text>
//   <file> (<line>)Fatal error: <text>
// <col> is 0-based.
const MESSAGE_RE = /^(.*?) \((\d+)\)\s*(Error|Warning|Fatal error): (.*?)(?:, Position\[(\d+)\])?\s*$/;

function parseOutput(output) {
  const messages = [];
  for (const line of output.split(/\r?\n/)) {
    const m = MESSAGE_RE.exec(line);
    if (!m) continue;
    messages.push({
      file: m[1],
      line: parseInt(m[2], 10), // 1-based, as reported
      column: m[5] !== undefined ? parseInt(m[5], 10) : undefined, // 0-based
      severity: m[3] === 'Warning' ? 'warning' : 'error',
      message: m[4],
    });
  }
  return messages;
}

function buildArgs(options, sourceFile) {
  const args = [];
  if (options.listFile) args.push('-L');
  if (options.warnings) args.push('-w');
  if (options.debugInfo) args.push('-g');
  args.push(sourceFile);
  return args;
}

// Where to look for qaflisp, in this order:
//   1. the configured path (if set, nothing else is tried)
//   2. the source file's folder and its parents, up to the workspace folder
//   3. the workspace folders
//   4. the PATH
//   5. the DigiFlisp installation folders (DigiFlisp itself expects qaflisp.exe there)
//   6. the qaflisp.exe bundled with the extension
function candidatePaths({ configured, sourceDir, workspaceRoots = [], envPath = '', digiflispDirs = [], bundled }) {
  if (configured) return [configured];
  const dirs = [];
  const roots = workspaceRoots.map((r) => path.resolve(r));
  let dir = path.resolve(sourceDir);
  const root = roots.find((r) => isInside(dir, r));
  for (;;) {
    dirs.push(dir);
    if (!root || dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dirs.push(...roots);
  dirs.push(...envPath.split(path.delimiter).filter(Boolean));
  dirs.push(...digiflispDirs);
  const seen = new Set();
  const result = [];
  for (const d of dirs) {
    for (const name of EXE_NAMES) {
      const p = path.join(d, name);
      const key = process.platform === 'win32' ? p.toLowerCase() : p;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(p);
      }
    }
  }
  if (bundled) result.push(bundled);
  return result;
}

// DigiFlisp installs to <Program Files>/GMV/DigiFlisp<n>. Newest version first.
function findDigiflispDirs(env = process.env, readdir = (d) => fs.readdirSync(d, { withFileTypes: true })) {
  if (process.platform !== 'win32') return [];
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean).map((p) => path.join(p, 'GMV'));
  const dirs = [];
  for (const base of [...new Set(bases)]) {
    let entries;
    try {
      entries = readdir(base);
    } catch {
      continue;
    }
    entries
      .filter((e) => e.isDirectory() && /^DigiFlisp/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .forEach((name) => dirs.push(path.join(base, name)));
  }
  return dirs;
}

// The copy shipped in the extension's bin folder (Windows only).
function bundledQaflisp(extensionRoot) {
  return process.platform === 'win32' ? path.join(extensionRoot, 'bin', 'qaflisp.exe') : undefined;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function findQaflisp(opts, exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile()) {
  return candidatePaths(opts).find(exists);
}

// qaflisp writes .s19/.lst/.fmem into its working directory, so it runs in the
// source file's folder to put them next to the source.
function runQaflisp(exe, sourceFile, options) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(options, sourceFile);
    execFile(exe, args, { cwd: path.dirname(sourceFile), windowsHide: true }, (err, stdout, stderr) => {
      // qaflisp's exit code is the number of errors, so a non-zero code is normal.
      if (err && typeof err.code !== 'number') return reject(err);
      const output = stdout + stderr;
      resolve({ args, output, exitCode: err ? err.code : 0, messages: parseOutput(output) });
    });
  });
}

module.exports = { parseOutput, buildArgs, candidatePaths, findDigiflispDirs, bundledQaflisp, findQaflisp, runQaflisp };
