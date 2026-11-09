import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectResponse } from '@clawee/protocol';
import { createWorkspaceFileSearchService } from '../../src/workspace-files/search.js';
import { isSearchPathInsideRoot, searchRelativePath } from '../../src/workspace-files/search-paths.js';

let tempDir = '';
afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

describe('搜索路径的平台语义', () => {
  it('POSIX 保留字面量反斜杠，Windows 转换目录分隔符', () => {
    expect(searchRelativePath('/work', { root: '/work', path: 'docs/a\\b.md' }, posix)).toBe('docs/a\\b.md');
    expect(searchRelativePath('C:\\work', { root: 'c:\\work', path: 'docs\\需求.md' }, win32)).toBe('docs/需求.md');
  });

  it.each(['../outside.md', 'docs/../../outside.md', '/work/file.md', 'node_modules/a.md', 'docs/../a.md', 'a\0.md'])('拒绝 POSIX 无效路径 %s', path => {
    expect(searchRelativePath('/work', { root: '/work', path }, posix)).toBeUndefined();
  });

  it.each(['..\\outside.md', 'C:\\work\\a.md', 'C:a.md', '\\\\server\\a.md', '\\a.md', 'docs\\node_modules\\a.md'])('拒绝 Windows 无效路径 %s', path => {
    expect(searchRelativePath('C:\\work', { root: 'C:\\work', path }, win32)).toBeUndefined();
  });

  it('根目录及真实目标使用路径关系判断', () => {
    expect(searchRelativePath('/work', { root: '/work-other', path: 'a.md' }, posix)).toBeUndefined();
    expect(isSearchPathInsideRoot('/work', '/work-other/a.md', posix)).toBe(false);
    expect(isSearchPathInsideRoot('C:\\work', 'D:\\work\\a.md', win32)).toBe(false);
    expect(isSearchPathInsideRoot('C:\\work', 'c:\\work\\a.md', win32)).toBe(true);
  });
});

describe('工作区文件搜索', () => {
  function setup() {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-search-'));
    const root = realpathSync(tempDir);
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    const project = {
      id: 'project', cwd: workspace, canonicalCwd: workspace,
      directoryState: 'available', status: 'active'
    } as ProjectResponse;
    const request = vi.fn(async (_method: string, _params: unknown): Promise<unknown> => ({ files: [] }));
    const service = createWorkspaceFileSearchService({
      projects: { getProject: id => id === project.id ? project : undefined },
      client: { request: <T>(method: string, params: unknown) => request(method, params) as Promise<T> }
    });
    const match = (path: string, match_type = 'file') => ({ root: workspace, path, match_type });
    return { workspace, project, request, service, match };
  }

  it('验证项目当前状态和真实目录，空查询也不能绕过项目验证', async () => {
    const { project, service, request, workspace } = setup();
    await expect(service.search({ projectId: 'missing', query: '' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    project.status = 'archived';
    await expect(service.search({ projectId: 'project', query: '' })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    project.status = 'active';
    await expect(service.search({ projectId: 'project', query: '' })).resolves.toEqual({ files: [] });
    rmSync(workspace, { recursive: true });
    await expect(service.search({ projectId: 'project', query: '' })).rejects.toMatchObject({ code: 'PROJECT_DIRECTORY_UNAVAILABLE' });
    expect(request).not.toHaveBeenCalled();
  });

  it('不依赖会话，按 Runtime 顺序保留普通文件并去重和限制数量', async () => {
    const { service, request, workspace, match } = setup();
    const paths = Array.from({ length: 25 }, (_, i) => `需求 ${i}.md`);
    paths.forEach(path => writeFileSync(join(workspace, path), '内容'));
    request.mockResolvedValue({ files: [match(paths[0]!), match(paths[0]!), match('missing'), match('directory', 'directory'), ...paths.slice(1).map(path => match(path))] });
    const result = await service.search({ projectId: 'project', query: '需求' });
    expect(request).toHaveBeenCalledWith('fuzzyFileSearch', { query: '需求', roots: [workspace] });
    expect(result.files.map(file => file.path)).toEqual(paths.slice(0, 20));
  });

  it.skipIf(process.platform === 'win32')('过滤外部与忽略目录符号链接、特殊文件，保留工作区内文件链接和特殊文件名', async () => {
    const { service, request, workspace, match } = setup();
    mkdirSync(join(workspace, 'node_modules'));
    writeFileSync(join(workspace, 'node_modules/hidden.md'), 'hidden');
    writeFileSync(join(tempDir, 'outside.md'), 'outside');
    const path = '中文 "a\\b\n.md';
    writeFileSync(join(workspace, path), '内容');
    symlinkSync(join(tempDir, 'outside.md'), join(workspace, 'external.md'));
    symlinkSync(join(workspace, 'node_modules/hidden.md'), join(workspace, 'hidden.md'));
    symlinkSync(join(workspace, path), join(workspace, 'internal.md'));
    mkdirSync(join(workspace, 'directory'));
    request.mockResolvedValue({ files: [
      match('external.md'), match('hidden.md'), match('node_modules/hidden.md'),
      match('../outside.md'), match('directory'), match('missing'),
      { ...match(path), root: tempDir }, match(path), match('internal.md')
    ] });
    expect(await service.search({ projectId: 'project', query: 'md' })).toEqual({
      files: [{ name: path, path }, { name: 'internal.md', path: 'internal.md' }]
    });
  });

  it('Runtime 失败向上返回错误而不是空列表', async () => {
    const { service, request } = setup();
    request.mockRejectedValue(new Error('search timed out'));
    await expect(service.search({ projectId: 'project', query: 'md' })).rejects.toThrow('search timed out');
  });
});
