import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { ProjectResponse } from '@clawee/protocol';
import { createCodexAppServerClient } from '../../src/codex/app-server-client.js';
import { createWorkspaceFileSearchService } from '../../src/workspace-files/search.js';

const codexBin = process.env.CLAWEE_TEST_CODEX_BIN ?? fileURLToPath(new URL(
  `../../../desktop/.pack/codex-runtime/bin/codex${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url
));

it.skipIf(!existsSync(codexBin))('固定 Runtime 在隔离工作区搜索中文、特殊文件名、忽略目录与符号链接', async () => {
  expect(execFileSync(codexBin, ['--version'], { encoding: 'utf8' })).toContain('0.151.0');
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'clawee-search-runtime-')));
  const workspace = join(tempDir, 'workspace');
  mkdirSync(workspace);
  mkdirSync(join(workspace, 'docs'));
  const paths = ['docs/中文需求.md', '空格 文件.md'];
  if (process.platform !== 'win32') paths.push('引号"文件.md', '反斜杠\\文件.md', '换行\n文件.md');
  paths.forEach(path => writeFileSync(join(workspace, path), `当前内容：${path}`));
  for (const dir of ['node_modules', '.runtime', 'build', 'dist']) {
    mkdirSync(join(workspace, dir));
    writeFileSync(join(workspace, dir, 'filtered.md'), 'hidden');
  }
  writeFileSync(join(workspace, '.gitignore'), 'gitignored.md\n');
  writeFileSync(join(workspace, 'gitignored.md'), 'Runtime 自行决定额外忽略规则');
  writeFileSync(join(tempDir, 'outside.md'), 'outside');
  if (process.platform !== 'win32') {
    symlinkSync(join(tempDir, 'outside.md'), join(workspace, 'external.md'));
    symlinkSync(join(workspace, 'node_modules/filtered.md'), join(workspace, 'hidden.md'));
    symlinkSync(join(workspace, paths[0]!), join(workspace, 'internal.md'));
  }
  const codexHome = join(tempDir, 'codex-home');
  mkdirSync(codexHome);
  const client = createCodexAppServerClient({ codexBin, codexHome, requestTimeoutMs: 10_000 });
  const project = { id: 'p', cwd: workspace, canonicalCwd: workspace, directoryState: 'available', status: 'active' } as ProjectResponse;
  const service = createWorkspaceFileSearchService({ client, projects: { getProject: () => project } });
  try {
    for (const path of paths) {
      const query = path.includes('/') ? path : path.slice(0, 2);
      const response = await service.search({ projectId: 'p', query });
      expect(response.files.map(file => file.path)).toContain(path);
    }
    for (const query of ['filtered', 'external', 'hidden']) {
      expect((await service.search({ projectId: 'p', query })).files).toEqual([]);
    }
    if (process.platform !== 'win32') {
      expect((await service.search({ projectId: 'p', query: 'internal' })).files.map(file => file.path)).toContain('internal.md');
    }
  } finally {
    await client.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}, 30_000);
