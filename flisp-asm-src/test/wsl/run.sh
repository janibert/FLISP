#!/bin/bash
# Runs all tests on Linux: npm test with the Linux qaflisp, then the VS Code host tests with a
# Linux VS Code. Started from Windows by test/wsl/run.js (npm run test:wsl), or directly on Linux.
# Looks for (no sudo needed, tarballs unpacked into the home folder are fine):
#   node     PATH or ~/tools/node/bin
#   qaflisp  PATH, ~/digiflisp or /usr/share/digiflisp (DigiFlisp for Linux, www.gbgmv.se)
#   VS Code  VSCODE_EXECUTABLE, ~/tools/vscode/code or `code` on the PATH (host tests are skipped without)
# Windows programs reached through WSL (/mnt/...) are left out of the PATH, so that nothing runs
# the Windows node, qaflisp.exe or VS Code by accident.

cd "$(dirname "$0")/../.." || exit 1
linux_path=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)
export PATH="$HOME/tools/node/bin:$HOME/digiflisp:/usr/share/digiflisp:$linux_path"

if ! command -v node >/dev/null; then echo "node not found (PATH or ~/tools/node)"; exit 1; fi
echo "node $(node --version), qaflisp: $(command -v qaflisp || echo 'not found - comparisons are skipped')"
npm test
status=$?

if [ -z "${VSCODE_EXECUTABLE:-}" ] && [ -x "$HOME/tools/vscode/code" ]; then export VSCODE_EXECUTABLE="$HOME/tools/vscode/code"; fi
if [ -n "${VSCODE_EXECUTABLE:-}" ] || command -v code >/dev/null; then
  npm run test:vscode || status=1
else
  echo "skip  VS Code host tests (no Linux VS Code: set VSCODE_EXECUTABLE or unpack it into ~/tools/vscode)"
fi
exit $status
