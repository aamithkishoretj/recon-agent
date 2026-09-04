import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const python = join(root, 'venv', windows ? 'Scripts/python.exe' : 'bin/python');
const vite = join(root, 'frontend/node_modules/vite/bin/vite.js');

if (!existsSync(python) || !existsSync(vite)) {
  console.error('Missing local dependencies. Follow "Local development" in README.md first.');
  process.exit(1);
}

const check = spawnSync(python, ['-c', 'import fastapi, uvicorn, sqlalchemy'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (check.error || check.status !== 0) {
  console.error('Backend dependencies unavailable. Install backend/requirements.txt using the venv Python.');
  if (check.error) console.error(check.error.message);
  process.exit(1);
}

const children = [];
const showcase = process.argv.includes('--showcase');
const liveAi = process.argv.includes('--live-ai');
if (liveAi && !process.env.GEMINI_API_KEY) {
  console.error('Live AI requires GEMINI_API_KEY in the current environment.');
  process.exit(1);
}
if (process.argv.includes('--demo') || showcase) {
  console.log(showcase
    ? 'Preparing the five-case presentation dataset; existing data will not be changed.'
    : 'Preparing a fresh synthetic demo; existing data will not be changed.');
  const preparationScript = showcase ? 'prepare_showcase.py' : 'prepare_demo.py';
  const prepared = spawnSync(python, [join(root, 'backend/scripts', preparationScript)], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  if (prepared.error || prepared.status !== 0) {
    console.error(prepared.stderr || prepared.error?.message || 'Demo preparation failed.');
    process.exit(1);
  }
  const demo = JSON.parse(prepared.stdout);
  if (!demo.evaluation.all_checks_passed) {
    console.error('Demo validation failed. Inspect: ' + demo.report);
    process.exit(1);
  }
  process.env.RECON_DATA_DIR = demo.data_dir;
  process.env.RECON_DB_PATH = demo.db_path;
  process.env.RECON_AI_MODE = liveAi ? 'live' : 'mock';
  console.log(`Verified ${demo.records} synthetic records. AI mode: ${liveAi ? 'LIVE Gemini' : 'MOCK (no provider call)'}.`);
  if (showcase) console.log(`Showcase manifest: ${demo.demo_cases}`);
  console.log(`Demo report: ${demo.report}`);
}
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    if (windows) {
      // Stop only this launcher's own process trees, including reload workers.
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore', windowsHide: true,
      });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
        if (error.code !== 'ESRCH') console.error(error.message);
      }
    }
  }
  process.exitCode = code;
}

function start(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd, stdio: 'inherit', windowsHide: true, detached: !windows,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped (${signal || code}); stopping the other service.`);
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

console.log('Starting ReconAgent: http://localhost:5173');
console.log('API docs: http://127.0.0.1:8000/docs');
console.log('Press Ctrl+C to stop both services. Existing reconciliation data is preserved.');

start('Backend', python, [
  '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000',
  '--reload', '--reload-dir', 'app',
], join(root, 'backend'));
start('Frontend', process.execPath, [vite, '--strictPort', '--host', '127.0.0.1'], join(root, 'frontend'));
