#!/usr/bin/env node
// `pnpm dev`: run the API server and the Vite dev server together, with no
// extra dependency (no `concurrently`). Ctrl-C stops both.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (name, cmd, args) => {
  const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  p.on('exit', (code) => { if (!stopping) { console.error(`[dev] ${name} exited (${code}); stopping`); stop(code ?? 1); } });
  return p;
};
let stopping = false;
const kids = [
  run('server', process.execPath, ['--watch', 'server/index.js']),
  run('vite', process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')]),
];
function stop(code = 0) { stopping = true; for (const k of kids) k.kill('SIGTERM'); process.exit(code); }
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
