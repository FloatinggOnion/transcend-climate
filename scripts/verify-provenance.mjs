#!/usr/bin/env node
// Confirms that every file marked "verbatim" in provenance/PORT-MANIFEST.json is still
// byte-identical to what was audited and ported from God's Eye View commit 880a672b.
// "modified" files are listed for transparency. Exit 1 if a verbatim file changed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'provenance', 'PORT-MANIFEST.json'), 'utf8'));
let bad = 0;
for (const f of manifest.files) {
  const actual = createHash('sha256').update(readFileSync(join(ROOT, f.dest))).digest('hex');
  if (f.status === 'verbatim') {
    const ok = actual === f.sourceSha256;
    if (!ok) bad += 1;
    console.log(`${ok ? 'OK      ' : 'CHANGED '} verbatim  ${f.dest}`);
  } else console.log(`info     ${f.status.split(':')[0].padEnd(9)} ${f.dest}${actual === f.destSha256 ? '' : '  (edited since port)'}`);
}
console.log(`\nUpstream ${manifest.upstream} @ ${manifest.upstreamCommit.slice(0, 8)} — ${manifest.license}`);
process.exit(bad ? 1 : 0);
