const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const execName = pkg.build?.executableName || pkg.name || 'electron';
const productName = pkg.build?.productName || pkg.productName || execName;

const candidates = [
  path.join(root, 'node_modules/electron/dist/electron'),
  path.join(root, 'node_modules/.bin/electron'),
  path.join(root, 'dist/linux-unpacked', execName),
  path.join(root, 'dist/linux-unpacked', productName),
  path.join(root, 'dist/linux-unpacked/foranly-desktop'),
  path.join(root, 'dist/linux-unpacked/closedoor'),
];

let bin = candidates.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!bin) {
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) bin = resolved;
  } catch {
    // without a downloaded Electron binary there is nothing else to try
  }
}

if (!bin) {
  console.error('No Electron binary found. Tried:\n  ' + candidates.join('\n  '));
  console.error('Run "npx electron-builder --linux dir" once, or reinstall electron with its postinstall script enabled.');
  process.exit(1);
}

const env = { ...process.env };
const binDir = path.dirname(bin);
if (binDir.includes('linux-unpacked') || binDir.includes('win-unpacked')) {
  env.LD_LIBRARY_PATH = binDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
}

const child = spawn(bin, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code || 0);
});
child.on('error', (err) => {
  console.error('Failed to launch Electron:', err.message);
  process.exit(1);
});
