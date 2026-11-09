import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
function spawnCorepack(argv, options) {
  if (process.platform !== 'win32') return spawnSync('corepack', argv, options);
  const locations = spawnSync('where.exe', ['corepack'], { encoding: 'utf8' });
  if (locations.error) throw locations.error;
  const cli = (locations.stdout ?? '').trim().split(/\r?\n/)
    .filter(Boolean)
    .map(shim => resolve(dirname(shim), 'node_modules/corepack/dist/corepack.js'))
    .find(existsSync);
  if (!cli) throw new Error('未找到 Corepack JavaScript 入口，请安装 Node.js 24 和 Corepack');
  return spawnSync(process.execPath, [cli, ...argv], options);
}
function run(program, argv, directory) {
  const shims = mkdtempSync(resolve(tmpdir(), 'clawee-corepack-'));
  let result;
  try {
    const enabled = spawnCorepack(['enable', '--install-directory', shims, 'pnpm'], { stdio: 'inherit' });
    if (enabled.error) throw enabled.error;
    if (enabled.status !== 0) throw new Error('无法准备 Corepack pnpm 入口');
    // 子脚本中的 pnpm 也必须遵守当前组件的 packageManager，不能落到全局版本。
    const launch = program === 'corepack' ? spawnCorepack : (args, options) => spawnSync(program, args, options);
    result = launch(argv, {
      cwd: resolve(root, directory), stdio: 'inherit',
      env: { ...process.env, PATH: shims + delimiter + (process.env.PATH ?? '') }
    });
  } finally {
    rmSync(shims, { recursive: true, force: true });
  }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === 'setup') {
  run('corepack', ['pnpm', 'install', '--frozen-lockfile'], 'client');
} else if (command === 'client') {
  run('corepack', ['pnpm', ...args], 'client');
} else {
  console.error('用法：node scripts/clawee.mjs setup | client <命令>');
  process.exitCode = 1;
}
