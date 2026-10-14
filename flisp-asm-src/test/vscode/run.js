// Runs test/vscode/suite.js inside the installed VS Code (npm run test:vscode). Opens a window
// for a few seconds, with a temporary workspace, user data and extensions folder.
// VS Code is found through the `code` command on the PATH, or set VSCODE_EXECUTABLE to the
// executable (Code.exe, code, or Electron on macOS).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findVSCode() {
  if (process.env.VSCODE_EXECUTABLE) return process.env.VSCODE_EXECUTABLE;
  const command = process.platform === 'win32' ? 'code.cmd' : 'code';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const file = dir && path.join(dir, command);
    if (!file || !fs.existsSync(file)) continue;
    const root = path.dirname(path.dirname(fs.realpathSync(file))); // <root>/bin/code
    const candidates = [path.join(root, 'Code.exe'), path.join(root, 'code'),
      path.join(root, '..', '..', 'MacOS', 'Electron'), path.join(root, '..', '..', 'MacOS', 'Code')];
    const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (found) return found;
  }
  return undefined;
}

const exe = findVSCode();
if (!exe) {
  console.log('VS Code not found: put the `code` command on the PATH or set VSCODE_EXECUTABLE.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flisp-vscode-'));
const workspace = path.join(tmp, 'workspace');
fs.mkdirSync(workspace);
const result = path.join(tmp, 'result.txt');
const env = { ...process.env, FLISP_TEST_RESULT: result };
delete env.ELECTRON_RUN_AS_NODE; // set inside VS Code terminals; Code.exe would start as plain Node

const args = [
  `--extensionDevelopmentPath=${path.resolve(__dirname, '..', '..')}`,
  `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
  `--user-data-dir=${path.join(tmp, 'user')}`,
  `--extensions-dir=${path.join(tmp, 'extensions')}`,
  '--disable-extensions', // all except this one
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  // Linux without a setuid chrome-sandbox (VS Code unpacked from the tarball, e.g. in WSL)
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  workspace,
];
console.log(`      (VS Code: ${exe})`);
const child = spawn(exe, args, { env, stdio: 'ignore' });
child.on('exit', (code) => {
  const ran = fs.existsSync(result);
  process.stdout.write(ran ? fs.readFileSync(result, 'utf8') : 'FAIL  no result: the test suite did not run\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(code || (ran ? 0 : 1));
});
