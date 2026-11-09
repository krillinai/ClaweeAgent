# ClaweeAgent

Clawee 是可自托管的 Agent 工作台。本仓库维护共享 Web、本地 daemon、Electron 桌面端和内嵌 Codex Runtime，支持任务、会话、工作区文件、Skill、定时任务及原生能力。Web＋daemon 服务模式也在本仓库维护。

企业账号、MCP 治理、授权审计、Skill Hub、知识库和共享资源由独立的 [aigateway](https://github.com/krillinai/aigateway) 提供。客户端通过 Gateway Origin 接入，不需要克隆服务端源码。

## 开发

使用 Node.js 24、Corepack 和 pnpm 10.33.3。

```sh
git clone git@github.com:krillinai/ClaweeAgent.git
cd ClaweeAgent
corepack pnpm run setup
corepack pnpm client:dev
```

浏览器工作台运行 `corepack pnpm web:dev`。Web＋daemon 服务模式运行 `corepack pnpm --dir client server:start`，打包运行 `corepack pnpm --dir client server:package`；后者不是 Gateway 部署包。

## 验证与发布

根目录 `corepack pnpm test` 检查工程脚本；客户端功能检查使用 `corepack pnpm client:test`。提交客户端构建或发布变更前运行 `corepack pnpm desktop:preflight:local`，验证实际打包 App 和内嵌 Web。

VERSION 是本仓库发布版本来源，延续现有客户端升级序列。`vX.Y.Z` 标签触发 Release Preflight，再执行桌面签名、公证和发布。新仓库需要独立配置受保护的 release Environment，配置项名称见 workflow；本次拆分不迁移密钥或触发正式发布。

沿用原 COS_PREFIX 与更新源时，现有客户端可继续升级；Gateway 不再写入此渠道。不要因仓库改名修改 appId、数据目录、Agent ID 或更新 URL。原仓库既有 Tag 和 Release 保持可用。

## 文档与维护

- [仓库边界和联调](docs/repository-maintenance.md)
- [Runtime 锁定与验收](docs/desktop-runtime-lock.md)
- [工作台说明](docs/workbench.md)
- [第三方声明](third_party/README.md)
- [Gateway 接入契约](https://github.com/krillinai/aigateway/blob/main/server/docs/integration/clawee-agent.md)

本仓库客户端源码来自已公开的 aigateway 提交 `3ddfa81a51584f3f6b8815686a2afd9569119e48`，保留原有 Apache-2.0 许可和 NOTICE；Git 历史以独立导入提交开始。
