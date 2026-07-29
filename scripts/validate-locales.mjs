/**
 * validate-locales.mjs
 *
 * Scans all .jsx / .js source files in src/ for t('key') calls,
 * then verifies every used key exists in ALL locale JSON files.
 * Exits with code 0 if all keys are present, or 1 if any are missing.
 *
 * Usage:  node scripts/validate-locales.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const LOCALE_DIR = join(ROOT, 'src', 'assets', 'services', 'i18n', 'locales');

// ── 1. Extract all t('key') calls from source ──

/**
 * Recursively collect all files matching a pattern under a root directory.
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!statSync(dir).isDirectory()) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.name.startsWith('.')) continue; // skip hidden
    if (entry.isDirectory()) {
      // skip node_modules, dist, etc.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// Regex that matches t('any.key.here') or t("any.key.here")
const T_CALL_REGEX = /\bt\(['"]([a-zA-Z_][a-zA-Z0-9_.]*)['"][\),]/g;

const sourceFiles = collectFiles(SRC_DIR, ['.jsx', '.js']);
const usedKeys = new Set();

for (const filePath of sourceFiles) {
  const content = readFileSync(filePath, 'utf-8');
  let match;
  while ((match = T_CALL_REGEX.exec(content)) !== null) {
    usedKeys.add(match[1]);
  }
}

// ── 2. Parse locale files ──

const localeFiles = readdirSync(LOCALE_DIR).filter(f => f.endsWith('.json'));

/**
 * Collect all leaf keys from a nested JSON object into a Set of dot-notation keys.
 */
function collectKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      keys.add(fullKey);
    } else if (typeof value === 'object' && value !== null) {
      const childKeys = collectKeys(value, fullKey);
      childKeys.forEach(k => keys.add(k));
    }
  }
  return keys;
}

// ── 3. Compare & report ──

let exitCode = 0;
let totalMissing = 0;
let totalFiles = 0;

for (const file of localeFiles) {
  totalFiles++;
  const filePath = join(LOCALE_DIR, file);
  let locale;
  try {
    locale = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`❌ [${file}] Failed to parse JSON:`, err.message);
    exitCode = 1;
    continue;
  }

  const definedKeys = collectKeys(locale);
  const missing = [...usedKeys].filter(k => !definedKeys.has(k));

  if (missing.length > 0) {
    totalMissing += missing.length;
    exitCode = 1;
    console.log(`❌ [${file}] — ${missing.length} key(s) missing:`);
    for (const k of missing) {
      console.log(`     - ${k}`);
    }
  } else {
    console.log(`✅ [${file}] — All ${usedKeys.size} used keys are defined`);
  }
}

// ── 4. Summary ──

if (exitCode === 0) {
  console.log(`\n✔ All ${usedKeys.size} translation keys are present across ${totalFiles} locale files.`);
} else {
  console.log(`\n✘ ${totalMissing} key(s) missing across ${totalFiles} locale files.`);
  console.log('  → Total used translation keys:', usedKeys.size);
}

process.exit(exitCode);
