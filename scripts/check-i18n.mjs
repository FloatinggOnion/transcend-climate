#!/usr/bin/env node
// Verifies every locale against the English source catalog:
//   - valid JSON, flat string→string
//   - same key set (no missing, no stray keys)
//   - identical {placeholder} sets per key
//   - no markup in strings (the UI renders translations as text; markup would show literally)
//   - lists which locales are still unreviewed drafts
//
//   node scripts/check-i18n.mjs        (exit 1 on any error)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGUAGES } from '../shared/languages.js';
import { placeholdersOf } from '../src/i18n/core.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');

export function checkLocales(dir = DIR) {
  const errors = []; const notes = [];
  const load = (code) => {
    try { return JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')); } catch (e) { errors.push(`${code}: cannot read/parse (${e.message})`); return null; }
  };
  const en = load('en');
  if (!en) return { errors, notes };
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  for (const f of files) if (!LANGUAGES.some((l) => l.code === f)) errors.push(`${f}.json has no entry in shared/languages.js`);

  for (const { code, status } of LANGUAGES) {
    const cat = code === 'en' ? en : load(code);
    if (!cat) continue;
    const missing = Object.keys(en).filter((k) => !(k in cat));
    const extra = Object.keys(cat).filter((k) => !(k in en));
    if (missing.length) errors.push(`${code}: missing ${missing.length} key(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    if (extra.length) errors.push(`${code}: unknown key(s): ${extra.slice(0, 5).join(', ')}`);
    for (const [k, v] of Object.entries(cat)) {
      if (typeof v !== 'string' || !v.trim()) { errors.push(`${code}.${k}: must be a non-empty string`); continue; }
      if (/[<>]/.test(v)) errors.push(`${code}.${k}: contains markup characters`);
      if (k in en) {
        const a = placeholdersOf(en[k]).join(','); const b = placeholdersOf(v).join(',');
        if (a !== b) errors.push(`${code}.${k}: placeholders {${b}} do not match English {${a}}`);
      }
    }
    if (status !== 'reviewed') notes.push(`${code}: draft (not reviewed by a native speaker)`);
  }
  return { errors, notes, keyCount: Object.keys(en).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { errors, notes, keyCount } = checkLocales();
  for (const n of notes) console.log(`note: ${n}`);
  if (errors.length) { for (const e of errors) console.error(`ERROR: ${e}`); process.exit(1); }
  console.log(`i18n OK: ${keyCount} keys × ${LANGUAGES.length} languages, all placeholders match`);
}
