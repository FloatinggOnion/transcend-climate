#!/usr/bin/env node
// Fails the build if the browser bundle would violate our CSP (no 'unsafe-eval'):
// any eval() / (0,eval) / `new Function` in the main (startup) chunks. Cesium's optional
// Gaussian-splat decoder uses bare Function(...) inside a lazy code path and is allowed
// (it is blocked at runtime by the CSP and this app never loads splats).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');
const FORBIDDEN = [/\(0,\s*eval\)/, /(?<![\w$.])eval\s*\(/, /new\s+Function\s*\(/];
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  for (const re of FORBIDDEN) if (re.test(src)) { console.error(`CSP violation risk in dist/assets/${f}: ${re}`); bad += 1; }
}
if (bad) process.exit(1);
console.log('bundle CSP check OK (no eval / new Function in startup code)');
