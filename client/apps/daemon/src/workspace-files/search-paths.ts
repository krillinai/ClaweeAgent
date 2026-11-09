import path from 'node:path';
import { isIgnoredDir } from './paths.js';

// POSIX 文件名中的反斜杠是普通字符，只在 Windows 上转换目录分隔符。
export function searchRelativePath(
  root: string,
  match: { root: string; path: string },
  paths: typeof path.posix = path
): string | undefined {
  if (!paths.isAbsolute(match.root) || paths.relative(root, match.root) !== '') return;
  if (!match.path || match.path.includes('\0') || paths.parse(match.path).root) return;
  const segments = match.path.split(paths.sep === '\\' ? /[\\/]/ : /\//);
  if (segments.some(segment => segment === '..' || isIgnoredDir(segment))) return;
  const relative = paths.relative(root, paths.resolve(root, match.path));
  if (!isSearchPathInsideRoot(root, paths.resolve(root, match.path), paths)) return;
  if (!relative) return;
  return paths.sep === '\\' ? relative.replace(/\\/g, '/') : relative;
}

export function isSearchPathInsideRoot(root: string, target: string, paths: typeof path.posix = path): boolean {
  const relative = paths.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}
