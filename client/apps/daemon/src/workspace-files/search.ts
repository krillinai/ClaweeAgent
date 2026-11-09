import { realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import type { WorkspaceFileSearchRequest, WorkspaceFileSearchResponse } from '@clawee/protocol';
import type { CodexAppServerRequestClient } from '../codex/app-server-client.js';
import type { ProjectManager } from '../projects/types.js';
import { WorkspaceFileError } from './errors.js';
import { assertRegularFile, isIgnoredDir } from './paths.js';
import { isSearchPathInsideRoot, searchRelativePath } from './search-paths.js';

export type WorkspaceFileSearchService = {
  search(request: WorkspaceFileSearchRequest): Promise<WorkspaceFileSearchResponse>;
};

type FuzzyFileSearchResponse = {
  files: Array<{ root: string; path: string; match_type: 'file' | 'directory' }>;
};

export function createWorkspaceFileSearchService(input: {
  projects: Pick<ProjectManager, 'getProject'>;
  client: Pick<CodexAppServerRequestClient, 'request'>;
}): WorkspaceFileSearchService {
  return {
    async search(request) {
      const project = input.projects.getProject(request.projectId);
      if (!project) throw new WorkspaceFileError('PROJECT_NOT_FOUND', '项目不存在', { statusCode: 404 });
      if (project.status === 'archived') throw new WorkspaceFileError('PROJECT_ARCHIVED', '项目已归档', { statusCode: 409 });
      let root: string;
      try {
        if (project.directoryState !== 'available' || !project.canonicalCwd) throw new Error();
        root = realpathSync(project.cwd);
        if (relative(root, project.canonicalCwd) !== '' || !statSync(root).isDirectory()) throw new Error();
      } catch {
        throw new WorkspaceFileError('PROJECT_DIRECTORY_UNAVAILABLE', '项目目录不可用', { statusCode: 422 });
      }
      if (!request.query.trim()) return { files: [] };
      const response = await input.client.request<FuzzyFileSearchResponse>('fuzzyFileSearch', {
        query: request.query, roots: [root]
      });
      const files: WorkspaceFileSearchResponse['files'] = [];
      const seen = new Set<string>();
      for (const match of response.files) {
        if (match.match_type !== 'file') continue;
        const path = searchRelativePath(root, match);
        if (path === undefined || seen.has(path)) continue;
        try {
          const target = realpathSync(resolve(root, path));
          if (!isSearchPathInsideRoot(root, target)) continue;
          if (relative(root, target).split(sep).some(isIgnoredDir)) continue;
          assertRegularFile(target);
        } catch {
          continue;
        }
        seen.add(path);
        files.push({ name: basename(path), path });
        if (files.length === 20) break;
      }
      return { files };
    }
  };
}
