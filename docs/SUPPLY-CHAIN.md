# Supply-chain review

This project was started from a folder the owner did not trust (several recent
npm/GitHub compromises). Nothing from that folder was executed. This is the evidence
trail, and how to repeat it.

## 1. Was the source folder authentic?

| Check | Result |
|---|---|
| Folder is a clone of `iitimii/gods-eye-view` (a **fork**), not the original | Found in `.git/config`; `package.json` credits `bilawalsidhu/gods-eye-view` |
| Local working tree vs the fork's `main` tarball | **Byte-identical** (`diff -rq`, 428 files) |
| Fork `main` = `880a672b…`, "Release God's Eye View as open source", author Bilawal Sidhu | Yes |
| Is that commit an ancestor of upstream `main`? | **Yes** (GitHub compare: `status: ahead`, `merge_base` = that commit, 0 behind). Commit SHAs are content-addressed, so the tree is the original author's, with nothing added by the fork |
| Git hooks / symlinks / stray executables | None (only 4 `.sh` helper scripts, read and not ported) |

Authentic is not the same as safe, so the code was scanned too.

## 2. Static scan of the source (read-only)

428 files scanned for `eval`, `new Function`, `child_process`, base64 decoding, dynamic
`import()`/`require()`, `sendBeacon`, WebSockets, hidden/bidi Unicode, minified blobs,
`curl | sh`. Every hit was in QA scripts/tests (not ported) or benign (`spawn` in a
comment, a debug-log `sendBeacon` to the app's own `/api/realtime/debug-log`, zero-width
joiners inside place names in OSM data). All **58 hosts** referenced by runtime code are
documented data providers. No raw IPs, paste sites, webhooks, Telegram/Discord, or tunnels.

## 3. Dependencies

| | Original (`package-lock.json`) | Transcend Climate (`pnpm-lock.yaml`) |
|---|---|---|
| Packages | 271 (41 prod, 230 dev) | **79** (39 reach the shipped app) |
| Known advisories (OSV) | **33 advisories across 11 package-versions**, incl. a **CRITICAL** DOMPurify bypass in a production dependency and several HIGH (vite 6.4.3, sharp, js-yaml, nanoid, postcss, ip-address…). 0 malware | **0** |
| Install-time scripts | esbuild, fsevents, **puppeteer** (downloads Chromium), **sharp** (native binaries) | none run; `ignore-scripts=true` + `strictDepBuilds` |
| Lockfile integrity | all registry, all hashed | all registry, all sha512-hashed |

Removed on purpose: `puppeteer`, `sharp`, `ws` (QA tooling only), `vite-plugin-cesium`
(replaced by a 40-line local plugin), `satellite.js`, `pbf`, `@mapbox/vector-tile`,
`mgrs`, `egm96-universal` (aviation/traffic features that were not ported).

Added: `@anthropic-ai/sdk@1.3.0` (the official SDK; Anthropic-published with npm
provenance) — the only addition, +8 transitive packages, all audited.

## 4. Hardening in this repo

- `.npmrc`: `ignore-scripts=true`, `save-exact=true` (no `^`/`~`).
- `pnpm-workspace.yaml`: `minimumReleaseAge` 7 days, `blockExoticSubdeps`, `strictDepBuilds`
  with an empty allow-list, `trustPolicy: no-downgrade`.
- `pnpm install --frozen-lockfile` in CI/Docker.
- `scripts/audit-deps.mjs` (below) fails on any HIGH finding.
- Strict CSP (no `unsafe-eval`, no inline script). This **caught a real problem**: Cesium's
  `Viewer` bundles Knockout.js, which runs `eval('this')` at load. The app uses the lower-level
  `CesiumWidget` instead, so no `eval` runs at startup.

## 5. Repeating the checks

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm audit                 # npm advisory DB
pnpm audit:deps            # OSV + malware reports, release age, install scripts,
                           # publisher changes, provenance, lockfile integrity
pnpm check:provenance      # ported files still byte-identical to the audited originals
```

`audit:deps` goes beyond CVEs because CVE databases only know *reported* problems:
it flags versions younger than 7 days, publishers that differ from the previous release
(account-takeover signal; CI-with-provenance and long-time maintainers are recognised and
downgraded), lost provenance, and any package not served from the registry.

## 6. Caveats and recommendations

- A static scan and a clean advisory database are strong evidence, **not proof**. Treat new
  versions of any dependency as untrusted until `pnpm audit:deps` passes again.
- Upstream is now **v0.3.0, ~3,000 commits ahead** of the ported snapshot. Nothing from
  later commits was reviewed or used. Review before pulling anything newer.
- pnpm 12 is available; this repo pins pnpm 11.5.2 (`packageManager`). Upgrade deliberately.
- Rotate any API key that was ever pasted into the old folder's `.env`.
