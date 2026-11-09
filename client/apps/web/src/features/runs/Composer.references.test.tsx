import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceFileSearchResponse } from '@clawee/protocol';
import { Composer } from './Composer.js';

const project = {
  id: 'p', name: '示例项目', cwd: '/workspace', canonicalCwd: '/workspace',
  directoryState: 'available' as const, sandbox: 'workspace-write' as const,
  profile: 'default', model: null, reasoning: null
};
const props = {
  projectId: project.id, projectName: project.name, projects: [project],
  permission: 'workspace-write' as const, profile: 'default', model: null,
  onSelectProject: vi.fn(), onSubmit: vi.fn()
};
const connector = {
  id: 'mcp:enterprise_rose', label: '玫瑰助手', description: 'enterprise_rose · 已开启',
  status: 'enabled' as const, insertText: '本次请求请优先使用连接器「玫瑰助手」（MCP：enterprise_rose） '
};
const result = (path: string): WorkspaceFileSearchResponse => ({ files: [{ name: path.split('/').at(-1)!, path }] });
const input = () => screen.getByRole('textbox', { name: '输入任务' });
const change = (value: string, caret = value.length) => fireEvent.change(input(), { target: { value, selectionStart: caret, selectionEnd: caret } });
const debounce = () => act(async () => { vi.advanceTimersByTime(200); });
function deferred() {
  let resolve!: (value: WorkspaceFileSearchResponse) => void;
  const promise = new Promise<WorkspaceFileSearchResponse>(done => { resolve = done; });
  return { promise, resolve };
}

describe('Composer 文件与 MCP 引用', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    props.onSubmit.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('裸 @ 不枚举文件，仅展示已启用 MCP；邮箱不触发', async () => {
    const search = vi.fn(async () => result('需求.md'));
    render(<Composer {...props} onSearchFiles={search} connectors={[connector, { ...connector, id: 'mcp:disabled', status: 'installed', label: '未启用' }]} />);
    change('name@example.com');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    change('@');
    await debounce();
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('文件 · 示例项目')).toBeInTheDocument();
    expect(screen.getByText('输入名称搜索工作区文件')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /玫瑰助手 enterprise_rose/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /未启用/ })).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input()).toHaveValue(connector.insertText);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('按展示名或稳定服务名包含匹配 MCP，保留前后正文', () => {
    render(<Composer {...props} connectors={[connector]} />);
    change('查询 @ROSE 后文', '查询 @ROSE'.length);
    fireEvent.click(screen.getByRole('option', { name: /玫瑰助手/ }));
    expect(input()).toHaveValue(`查询 ${connector.insertText} 后文`);
  });

  it('防抖搜索并用 JSON 字符串插入含引号、空格、换行和反斜杠的文件名', async () => {
    const path = 'docs/中文 "a\\b\n.md';
    const search = vi.fn(async () => result(path));
    render(<Composer {...props} onSearchFiles={search} />);
    change('根据 @中文 修改', '根据 @中文'.length);
    expect(search).not.toHaveBeenCalled();
    await debounce();
    expect(search).toHaveBeenCalledWith({ projectId: 'p', query: '中文' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    const text = `根据 @${JSON.stringify(path)}  修改`;
    expect(input()).toHaveValue(text);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect((input() as HTMLTextAreaElement).selectionStart).toBe(`根据 @${JSON.stringify(path)} `.length);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it.each(['', '开头 '])('隐藏 Skill 前缀下在 %s 插入文件，发送仍包含前缀', async text => {
    const onChange = vi.fn();
    const search = vi.fn(async () => result('src/a.ts'));
    render(<Composer {...props} initialPrompt="$review " onPromptChange={onChange} onSearchFiles={search}
      slashCommands={[{ id: 'skill:review', category: 'skill', label: '审核', description: '', insertText: '$review ' }]} />);
    change(`${text}@a 后文`, `${text}@a`.length);
    await debounce();
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input()).toHaveValue(`${text}@"src/a.ts"  后文`);
    expect(onChange).toHaveBeenLastCalledWith(`$review ${text}@"src/a.ts"  后文`);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect((input() as HTMLTextAreaElement).selectionStart).toBe(`${text}@"src/a.ts" `.length);
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });
    expect(props.onSubmit.mock.calls[0]![0]).toBe(`$review ${text}@"src/a.ts"  后文`);
  });

  it('A→B→A 的旧结果和防抖期间返回的响应均失效', async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    render(<Composer {...props} onSearchFiles={search} />);
    change('@A');
    await debounce();
    change('@B');
    await act(async () => first.resolve(result('旧 A')));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await debounce();
    change('@A');
    await debounce();
    await act(async () => third.resolve(result('最新 A')));
    await act(async () => second.resolve(result('旧 B')));
    expect(screen.getByRole('option', { name: /最新 A/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /旧/ })).not.toBeInTheDocument();
  });

  it('移除隐藏 Skill 时关闭旧候选，防止按旧偏移插入文件', async () => {
    const search = vi.fn(async () => result('src/a.ts'));
    render(<Composer {...props} initialPrompt="$review " onSearchFiles={search}
      slashCommands={[{ id: 'skill:review', category: 'skill', label: '审核', description: '', insertText: '$review ' }]} />);
    change('@a 后文', 2);
    await debounce();
    (input() as HTMLTextAreaElement).setSelectionRange(0, 0);
    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input()).toHaveValue('@a 后文');
  });

  it('键盘移出 @ 搜索词后关闭候选，不向旧区间插入', async () => {
    const search = vi.fn(async () => result('src/a.ts'));
    render(<Composer {...props} onSearchFiles={search} />);
    change('前文 @a 后文', 5);
    await debounce();
    fireEvent.select(input(), { target: { selectionStart: 0, selectionEnd: 0 } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input()).toHaveValue('前文 @a 后文');
  });

  it.each(['clear', 'escape', 'directory', 'project', 'unmount'] as const)('%s 后旧响应失效', async action => {
    const pending = deferred();
    const search = vi.fn(() => pending.promise);
    const view = render(<Composer {...props} onSearchFiles={search} />);
    change('@a');
    await debounce();
    if (action === 'clear') change('@');
    if (action === 'escape') fireEvent.keyDown(input(), { key: 'Escape' });
    if (action === 'directory') view.rerender(<Composer {...props} projects={[{ ...project, cwd: '/new', canonicalCwd: '/new' }]} onSearchFiles={search} />);
    if (action === 'project') view.rerender(<Composer {...props} projectId="other" onSearchFiles={search} />);
    if (action === 'unmount') view.unmount();
    await act(async () => pending.resolve(result('旧文件')));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    if (action === 'directory' || action === 'project') expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it.each(['loading', 'empty', 'error'] as const)('%s 时回车拦截，Esc 后可提交正文', async state => {
    const search = vi.fn(() => state === 'loading' ? new Promise<WorkspaceFileSearchResponse>(() => {})
      : state === 'error' ? Promise.reject(new Error()) : Promise.resolve({ files: [] }));
    render(<Composer {...props} onSearchFiles={search} />);
    change('@a');
    await debounce();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }); });
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('文件搜索失败仍可选择 MCP；重开候选可重试相同关键词', async () => {
    const search = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(result('rose.md'));
    render(<Composer {...props} onSearchFiles={search} connectors={[connector]} />);
    change('@rose');
    await debounce();
    expect(screen.getByText('文件搜索失败，请重试')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /玫瑰助手/ })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.click(input());
    await debounce();
    expect(screen.getByRole('option', { name: /rose.md/ })).toBeInTheDocument();
  });

  it('输入法组词时方向键、回车、Tab 和 Esc 全部交给输入法，Shift+Enter 保持换行', () => {
    render(<Composer {...props} connectors={[connector, { ...connector, id: 'mcp:second', label: '第二个' }]} />);
    change('@');
    const initial = input().getAttribute('aria-activedescendant');
    fireEvent.compositionStart(input());
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
      expect(fireEvent.keyDown(input(), { key })).toBe(true);
      expect(input().getAttribute('aria-activedescendant')).toBe(initial);
    }
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(input()).toHaveValue('@');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).not.toBe(initial);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('光标未移动的 selection 事件保留方向键已选中的候选', () => {
    render(<Composer {...props} connectors={[connector, { ...connector, id: 'mcp:second', label: '第二个' }]} />);
    change('@');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const selected = input().getAttribute('aria-activedescendant');
    fireEvent.select(input(), { target: { selectionStart: 1, selectionEnd: 1 } });
    expect(input().getAttribute('aria-activedescendant')).toBe(selected);
  });

  it('切换 / Skill 和 @ 时仅有一个菜单，Skill 候选也受输入法保护', () => {
    render(<Composer {...props} connectors={[connector]} slashCommands={[{ id: 'skill:review', category: 'skill', label: '审核', description: '', insertText: '$review ' }]} />);
    change('/');
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(input()).toHaveValue('/');
    change('@');
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(screen.queryByRole('option', { name: '审核' })).not.toBeInTheDocument();
  });
});
