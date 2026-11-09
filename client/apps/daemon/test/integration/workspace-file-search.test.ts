import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../helpers/build-server.js';

let server: FastifyInstance | undefined;
let tempDir = '';
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('文件搜索 API', () => {
  it('沿用鉴权、参数和项目错误；新任务无需创建会话即可搜索', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-search-api-'));
    const workspace = join(tempDir, 'workspace');
    mkdirSync(workspace);
    writeFileSync(join(workspace, '需求.md'), '当前内容');
    const request = vi.fn(async (_method: string, params: unknown) => ({ files: [
      { root: (params as { roots: string[] }).roots[0], path: '需求.md', match_type: 'file' }
    ] }));
    const close = vi.fn(async () => {});
    server = await buildServer({
      token: 'secret', dataDir: join(tempDir, 'runtime'),
      workspaceFileSearchClient: { request: <T>(method: string, params: unknown) => request(method, params) as Promise<T>, close }
    });
    const headers = { authorization: 'Bearer secret' };
    const project = (await server.inject({ method: 'POST', url: '/projects', headers, payload: { cwd: workspace } })).json().project;
    const url = (query = '需求', projectId = project.id) => `/workspace/files/search?${new URLSearchParams({ projectId, query })}`;
    expect((await server.inject({ url: url() })).statusCode).toBe(401);
    expect((await server.inject({ url: '/workspace/files/search?projectId=p', headers })).statusCode).toBe(400);
    expect((await server.inject({ url: url('a'.repeat(257)), headers })).json().error.code).toBe('VALIDATION_FAILED');
    expect((await server.inject({ url: `${url()}&query=duplicate`, headers })).statusCode).toBe(400);
    expect((await server.inject({ url: url('', 'missing'), headers })).json().error.code).toBe('PROJECT_NOT_FOUND');
    expect((await server.inject({ url: url(''), headers })).json()).toEqual({ files: [] });
    expect(request).not.toHaveBeenCalled();
    expect((await server.inject({ url: url(), headers })).json()).toEqual({ files: [{ name: '需求.md', path: '需求.md' }] });
    request.mockRejectedValueOnce(new Error('Runtime unavailable'));
    expect((await server.inject({ url: url(), headers })).statusCode).toBe(500);
    await server.inject({ method: 'POST', url: `/projects/${project.id}/archive`, headers });
    const archived = await server.inject({ url: url(), headers });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('PROJECT_ARCHIVED');
    await server.inject({ method: 'POST', url: `/projects/${project.id}/restore`, headers });
    rmSync(workspace, { recursive: true });
    const missing = await server.inject({ url: url(), headers });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe('PROJECT_DIRECTORY_UNAVAILABLE');
  });
});
