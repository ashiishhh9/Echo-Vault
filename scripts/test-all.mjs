import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';

function run(label, command, args, cwd) {
  process.stdout.write(`\n== ${label} ==\n`);
  const isCmdShim = windows && command.toLowerCase().endsWith('.cmd');
  const executable = isCmdShim ? (process.env.ComSpec || 'cmd.exe') : command;
  const executableArgs = isCmdShim ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
  const result = spawnSync(executable, executableArgs, { cwd, stdio: 'inherit', shell: false, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function pythonFor(projectDir) {
  if (process.env.PYTHON) return { command: process.env.PYTHON, args: [] };
  const venvPython = windows
    ? join(projectDir, '.venv', 'Scripts', 'python.exe')
    : join(projectDir, '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return { command: venvPython, args: [] };
  return { command: windows ? 'py' : 'python3', args: windows ? ['-3.11'] : [] };
}

const npm = windows ? 'npm.cmd' : 'npm';
run('Frontend type check and production build', npm, ['run', 'build'], root);
run('Node API, email, and dashboard regressions', npm, ['run', 'test:node'], root);

const backendDir = join(root, 'backend');
const backendPython = pythonFor(backendDir);
run('Python compatibility API tests (isolated temporary SQLite)', backendPython.command, [...backendPython.args, '-m', 'pytest', '-q'], backendDir);

const aiDir = join(root, 'ai-service');
const aiPython = pythonFor(aiDir);
run('AI-service tests (deterministic embeddings; no model download)', aiPython.command, [...aiPython.args, '-m', 'pytest', 'tests', '-q'], aiDir);

process.stdout.write('\nAll mandatory local checks passed.\n');
