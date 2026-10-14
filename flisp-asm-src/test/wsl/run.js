// Runs test/wsl/run.sh in WSL from Windows: all tests with the Linux Node, qaflisp and VS Code.
//   npm run test:wsl                  default WSL distribution
//   npm run test:wsl -- Ubuntu-24.04  that distribution (or set FLISP_WSL_DISTRO)
// What the distribution needs is described in run.sh.

const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  console.log('test:wsl runs from Windows; on Linux run: bash test/wsl/run.sh');
  process.exit(1);
}
const distro = process.argv[2] || process.env.FLISP_WSL_DISTRO;
// wsl.exe starts in the current folder (as /mnt/d/...), so a relative script path works
const args = [...(distro ? ['-d', distro] : []), '--', 'bash', 'test/wsl/run.sh'];
const r = spawnSync('wsl.exe', args, { cwd: path.resolve(__dirname, '..', '..'), stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
