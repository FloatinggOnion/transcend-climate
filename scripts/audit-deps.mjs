#!/usr/bin/env node
// Dependency supply-chain audit for pnpm-lock.yaml.
//
// CVE databases only know about *reported* problems, so this goes further:
//   1. OSV.dev advisories (CVEs/GHSAs) AND OpenSSF malware reports (MAL-*)
//   2. Release age (very new versions are the usual malware window)
//   3. Install-time scripts (preinstall/install/postinstall)
//   4. Lockfile integrity: every package must carry a sha512 hash and come
//      from the registry (no git/tarball sources)
//   5. Publisher change: the npm account that published this version differs
//      from the account that published the previous version (takeover signal)
//   6. Provenance: does the version carry an npm provenance attestation
//   7. Deprecation notices
//
// Network access: registry.npmjs.org and api.osv.dev only. Nothing from the
// dependencies is executed. Exit code 1 on any HIGH finding.
//
// Usage: node scripts/audit-deps.mjs [--json out.json] [--min-age-days 7] [--offline]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const OFFLINE = args.includes('--offline');
const MIN_AGE_DAYS = Number(opt('--min-age-days', 7));
const JSON_OUT = opt('--json', null);
const REGISTRY = 'https://registry.npmjs.org';
const OSV = 'https://api.osv.dev/v1';

/** Parse the `packages:` and `snapshots:` sections of a pnpm lockfile (v9 format). */
export function parseLockfile(text) {
  const lines = text.split('\n');
  let section = null;
  const packages = new Map(); // "name@ver" -> { integrity, exotic }
  const snapshots = new Map(); // "name@ver(peers)" -> [dep "name@ver", ...]
  const importers = { dependencies: [], devDependencies: [] };
  let cur = null; let curKind = null; let impKind = null;
  const unq = (s) => s.replace(/^'|'$/g, '');
  const splitKey = (k) => { // 'name@ver(peer)' -> {name, ver}
    const base = unq(k).replace(/\(.*$/, '');
    const at = base.lastIndexOf('@');
    return { name: base.slice(0, at), ver: base.slice(at + 1) };
  };
  for (const raw of lines) {
    if (/^\S/.test(raw)) { section = raw.replace(':', '').trim(); cur = null; continue; }
    if (section === 'importers') {
      const m = raw.match(/^ {4}(dependencies|devDependencies):/);
      if (m) { impKind = m[1]; continue; }
      const d = raw.match(/^ {6}(\S+):\s*$/);
      if (d && impKind) { cur = unq(d[1]); continue; }
      const v = raw.match(/^ {8}version: (\S+)/);
      if (v && cur && impKind) { importers[impKind].push(`${cur}@${v[1].replace(/\(.*$/, '')}`); cur = null; }
    } else if (section === 'packages') {
      const k = raw.match(/^ {2}(\S.*):\s*$/);
      if (k) { const { name, ver } = splitKey(k[1]); cur = `${name}@${ver}`; packages.set(cur, { integrity: null, exotic: false }); continue; }
      if (cur) {
        const integ = raw.match(/integrity: (sha\d+-[A-Za-z0-9+/=]+)/);
        if (integ) packages.get(cur).integrity = integ[1];
        if (/tarball:|repo:|type: git|directory:/.test(raw)) packages.get(cur).exotic = true;
      }
    } else if (section === 'snapshots') {
      const k = raw.match(/^ {2}(\S.*):(?: \{\})?\s*$/);
      if (k) { const { name, ver } = splitKey(k[1]); curKind = `${name}@${ver}`; if (!snapshots.has(curKind)) snapshots.set(curKind, []); continue; }
      const dep = raw.match(/^ {6}(\S+): (\S+)\s*$/);
      if (dep && curKind) { snapshots.get(curKind).push(`${unq(dep[1])}@${dep[2].replace(/\(.*$/, '')}`); }
    }
  }
  return { packages, snapshots, importers };
}

function reachable(roots, snapshots) {
  const seen = new Set(); const stack = [...roots];
  while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const d of snapshots.get(n) || []) stack.push(d); }
  return seen;
}

async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function getJson(url, init) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return undefined; // undefined = could not reach (distinct from null = 404)
}

const SEV_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

async function main() {
  const lock = parseLockfile(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'));
  const pkgIds = [...lock.packages.keys()];
  const prodSet = reachable(lock.importers.dependencies, lock.snapshots);
  const findings = []; // {pkg, severity, kind, detail}
  const add = (pkg, severity, kind, detail) => findings.push({ pkg, severity, kind, detail });

  // 4. Lockfile integrity
  for (const [id, meta] of lock.packages) {
    if (!meta.integrity) add(id, 'HIGH', 'no-integrity', 'package has no integrity hash in the lockfile');
    else if (!meta.integrity.startsWith('sha512-')) add(id, 'MEDIUM', 'weak-integrity', `integrity is ${meta.integrity.slice(0, 7)}, expected sha512`);
    if (meta.exotic) add(id, 'HIGH', 'exotic-source', 'package is resolved from a git/tarball/directory source, not the registry');
  }

  const stats = { total: pkgIds.length, prod: pkgIds.filter((p) => prodSet.has(p)).length, offline: OFFLINE };
  let scriptsBlocked = false;
  try { scriptsBlocked = /^ignore-scripts\s*=\s*true/m.test(readFileSync(join(ROOT, '.npmrc'), 'utf8')); } catch { /* no .npmrc */ }
  if (!scriptsBlocked) add('(project)', 'HIGH', 'scripts-not-blocked', 'ignore-scripts=true is missing from .npmrc');

  if (!OFFLINE) {
    // 1. OSV: CVEs + malware, in one batch call
    const queries = pkgIds.map((id) => { const at = id.lastIndexOf('@'); return { package: { ecosystem: 'npm', name: id.slice(0, at) }, version: id.slice(at + 1) }; });
    const batch = await getJson(`${OSV}/querybatch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries }) });
    if (!batch) add('(all)', 'HIGH', 'osv-unreachable', 'could not reach api.osv.dev; vulnerability status UNKNOWN');
    else {
      const ids = new Map();
      batch.results.forEach((r, i) => (r.vulns || []).forEach((v) => { if (!ids.has(v.id)) ids.set(v.id, []); ids.get(v.id).push(pkgIds[i]); }));
      const details = await pool([...ids.keys()], 6, (id) => getJson(`${OSV}/vulns/${id}`));
      [...ids.keys()].forEach((id, k) => {
        const d = details[k] || {};
        const isMal = id.startsWith('MAL-');
        const sev = (d.database_specific?.severity || '').toUpperCase();
        const level = isMal ? 'HIGH' : (sev === 'CRITICAL' || sev === 'HIGH') ? 'HIGH' : sev === 'MODERATE' || sev === 'MEDIUM' ? 'MEDIUM' : sev ? 'LOW' : 'MEDIUM';
        for (const pkg of ids.get(id)) add(pkg, level, isMal ? 'MALWARE' : 'advisory', `${id}${d.aliases?.length ? ` (${d.aliases.join(', ')})` : ''}: ${d.summary || 'no summary'}${prodSet.has(pkg) ? '' : ' [dev-only]'}`);
      });
    }

    // 2,3,5,6,7. Registry metadata
    const metas = await pool(pkgIds, 8, async (id) => {
      const at = id.lastIndexOf('@'); const name = id.slice(0, at); const ver = id.slice(at + 1);
      const doc = await getJson(`${REGISTRY}/${name.replace('/', '%2F')}`, { headers: { accept: 'application/json' } });
      return { id, name, ver, doc };
    });
    const now = Date.now();
    for (const { id, name, ver, doc } of metas) {
      if (doc === undefined) { add(id, 'MEDIUM', 'registry-unreachable', 'could not fetch registry metadata'); continue; }
      if (doc === null) { add(id, 'HIGH', 'not-in-registry', 'package/version not found on registry.npmjs.org'); continue; }
      const v = doc.versions?.[ver];
      if (!v) { add(id, 'HIGH', 'version-missing', 'locked version is not published on the registry (unpublished/removed?)'); continue; }
      const published = doc.time?.[ver] ? new Date(doc.time[ver]).getTime() : null;
      if (published) {
        const ageDays = (now - published) / 86_400_000;
        if (ageDays < MIN_AGE_DAYS) add(id, 'HIGH', 'too-new', `published ${ageDays.toFixed(1)} days ago (< ${MIN_AGE_DAYS})`);
        else if (ageDays < 30) add(id, 'INFO', 'recent', `published ${Math.round(ageDays)} days ago`);
      }
      const sc = v.scripts || {};
      const hooks = ['preinstall', 'install', 'postinstall'].filter((h) => sc[h]);
      if (hooks.length || v.hasInstallScript) {
        add(id, scriptsBlocked ? 'LOW' : 'MEDIUM', 'install-script',
          `declares install-time scripts: ${hooks.join(', ') || '(flagged by registry)'}${scriptsBlocked ? ' — blocked by ignore-scripts in .npmrc' : ' — NOT blocked: set ignore-scripts=true in .npmrc'}`);
      }
      if (v.deprecated) add(id, 'LOW', 'deprecated', String(v.deprecated).slice(0, 160));
      if (!v.license && !v.licenses) add(id, 'LOW', 'no-license', 'no license declared');
      // publisher change vs. the previous published version
      const sorted = Object.keys(doc.versions).filter((x) => doc.time?.[x] && !x.includes('-')).sort((a, b) => new Date(doc.time[a]) - new Date(doc.time[b]));
      const idx = sorted.indexOf(ver);
      const prev = idx > 0 ? doc.versions[sorted[idx - 1]] : null;
      const who = v._npmUser?.name; const prevWho = prev?._npmUser?.name;
      const attested = !!v.dist?.attestations?.provenance;
      if (who && prevWho && who !== prevWho) {
        const maintainers = (doc.maintainers || []).map((m) => m.name);
        const ageDays = published ? (now - published) / 86_400_000 : 0;
        if (who === 'GitHub Actions' && attested) add(id, 'INFO', 'publisher-ci', `moved to CI trusted publishing (provenance attested); previous publisher "${prevWho}"`);
        else if (ageDays > 365) add(id, 'INFO', 'publisher-changed-old', `published by "${who}" ${Math.round(ageDays)} days ago, previous version by "${prevWho}"`);
        else if (maintainers.includes(who)) add(id, 'LOW', 'publisher-changed', `published by "${who}" (a current maintainer); previous version by "${prevWho}"`);
        else add(id, 'MEDIUM', 'publisher-changed', `published by "${who}", who is NOT a listed maintainer; previous version by "${prevWho}" — verify`);
      }
      const prevAttested = !!prev?.dist?.attestations?.provenance;
      if (prevAttested && !attested) add(id, 'HIGH', 'provenance-lost', 'previous version had npm provenance; this one does not');
      stats.attested = (stats.attested || 0) + (attested ? 1 : 0);
    }
  }

  findings.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || a.pkg.localeCompare(b.pkg));
  const counts = findings.reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] || 0) + 1 }), {});
  console.log(`\nAudited ${stats.total} packages (${stats.prod} reach the shipped app; ${stats.total - stats.prod} dev/build-only)${OFFLINE ? ' [OFFLINE: lockfile checks only]' : ''}`);
  if (stats.attested !== undefined) console.log(`${stats.attested}/${stats.total} versions carry npm provenance attestations`);
  console.log(`Findings: ${JSON.stringify(counts)}\n`);
  for (const f of findings) if (f.severity !== 'INFO') console.log(`[${f.severity}] ${f.pkg}  ${f.kind}\n        ${f.detail}`);
  if (!findings.some((f) => f.severity !== 'INFO')) console.log('No findings above INFO.');
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), stats, counts, findings }, null, 1));
  process.exitCode = findings.some((f) => f.severity === 'HIGH') ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
