import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createEnterpriseHttpClient } from '../client/apps/daemon/dist/enterprise/http-client-2026-07-30.js';

// 只接受专门创建的隔离联调环境，配置文件必须放在仓库外。
const configPath = process.env.CLAWEE_GATEWAY_SMOKE_CONFIG;
assert(configPath, '请设置 CLAWEE_GATEWAY_SMOKE_CONFIG');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
assert.equal(config.disposable, true, '联调需要一次性测试环境');
const client = createEnterpriseHttpClient({ origin: config.gateway });
const identity = `clawee_${randomUUID()}`;
try {
  await client.register({ email: config.email, password: config.password, name: '跨仓库联调用户' }, identity);
  const session = await client.login({ email: config.email, password: config.password }, identity);
  const token = session.accessToken;
  const me = await client.getMe(token);
  assert.equal(me.account.subjectId, session.account.subjectId);
  assert(session.agentId);
  await client.getMcpCatalog(token);
  await client.listSkillSpaces(token);
  await client.listSkills(token);
  // 隔离环境不配置百炼凭据，知识库路由按现有行为不启用。
  await assert.rejects(client.listKnowledgeBases(token), {
    code: 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND'
  });
  await client.listSharedSpaces(token);
  await client.logout(token);
  await assert.rejects(client.getMe(token), { code: 'ENTERPRISE_UNAUTHORIZED' });
  console.log('跨仓库联调通过：注册登录、身份、MCP 目录、Skill、共享空间、知识库未启用行为及会话失效。');
} catch (error) {
  console.error('跨仓库联调失败：', error.code ?? error.name);
  process.exitCode = 1;
}
