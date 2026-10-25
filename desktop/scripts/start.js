const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const candidates = [
  path.join(root, 'dist/linux-unpacked/foranly-desktop'),
  path.join(root, 'node_modules/electron/dist/electron'),
  path.join(root, 'node_modules/.bin/electron'),
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
    bin = require('electron');
    if (typeof bin === 'function') {
      // should be path
    }
  } catch (e) {
    // ignore
  }
}

if (!bin || typeof bin !== 'string' || !fs.existsSync(bin)) {
  console.error('No electron binary found. Tried:', candidates);
  process.exit(1);
}

const env = { ...process.env };
const libDir = path.dirname(bin);
if (libDir.includes('linux-unpacked')) {
  env.LD_LIBRARY_PATH = libDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
}

const child = spawn(bin, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code || 0));
