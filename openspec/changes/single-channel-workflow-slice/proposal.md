# Proposal: 单通道 Agent Workflow 最小纵向切片

## Why

当前仓库只有 OpenSpec、确定性门禁和本地 agent 派发等流程基建，还没有可运行的 Agent Workflow Runtime。需要先交付 PRD §19 Phase 1 的最小纵向切片，证明一份 workflow IR 能被校验、由真实本地 coding agent 执行、持久化为事件与 artifact，并在产品形态内被实时观察。

工程脚手架必须先于所有产品能力落地：只有先建立 pnpm workspace、TypeScript strict、测试分离、lint、Electron 薄壳骨架和真实 CI 接线，后续 issue 才有可编译、可测试、可验收的共同地基。按 D5，测试作者/实现者分离从第二个 task 起生效；脚手架 task 本身允许没有预先存在的 `acceptance/` 测试，由确定性 CI 判据和人审验收。

## What Changes

- 建立 pnpm 工作区与 Node.js 22 + TypeScript strict 工具链，接入 lint、vitest、Electron 薄壳骨架，并让 `ci`、`spec-validate`、`test-guard` 三个 required check 执行真实逻辑。
- 建立 `agent.workflow/v1` Canonical IR 的 L1 Schema 与 Phase 1 所需的 L2 图语义校验，附写死的单 Agent、无环 Cross-Agent Review 示例 IR，并统一返回可定位的结构化错误。
- 建立首个本地 `AgentAdapter`：spawn Codex `app-server` 的原生 stdio 通道，完成 JSON-RPC 握手、事件归一化、session 捕获和 final text 提取；用真实录制输出做表驱动回归测试。
- 建立单节点 orchestrator、PRD §10 状态机和 SQLite 持久化；`run_events` 按 run 使用连续递增 `seq` append-only 写入，final text 兜底成为可溯源的 `report` artifact。
- 建立 Hono HTTP/WebSocket 读模型，并在 Electron 薄壳窗口内用 React Flow 呈现只读节点画布、状态颜色、实时文本流和最终 artifact。

## Capabilities

### New Capabilities

- `build-pipeline`: pnpm/TypeScript/vitest/lint/Electron 工程地基、测试分离与 required checks 真实接线。
- `workflow-ir`: Canonical IR、示例 flow、L1/L2 校验与结构化错误契约。
- `agent-adapter`: Codex `app-server` 原生 adapter、事件归一化与真实录制 fixture 契约。
- `run-execution`: run/node 状态机、SQLite 事件日志和 final-text artifact 兜底。
- `run-ui`: Hono 实时读接口与 Electron 内的只读 React Flow 运行视图。

### Modified Capabilities

无。仓库按 D2 尚无 living specs，本 change 首次建立上述 capabilities。

## Impact

- 新增 `/shared`、`/server`、`/web`、`/desktop`、`/examples` 工作区及根级 pnpm 配置。
- 引入 zod、better-sqlite3、Hono、Vite、React、`@xyflow/react`、Electron、vitest、Playwright 等依赖。
- `ci` 移除“无 product source 时空转通过”的分支，改为安装依赖并真实执行 typecheck、lint、test；现有 `spec-validate` 与 `test-guard` 继续作为确定性门禁并在脚手架 PR 上实际运行。
- 运行时将 spawn 已安装且已登录的本地 Codex CLI；CI 不调用模型，adapter 的确定性门禁使用真实录制 fixture，真实通道由本地 smoke/demo 行为验收。
- 本提案只修改 `openspec/changes/single-channel-workflow-slice/`；实现由 tasks 播种后的独立 issues/PRs 完成。

## 验收判据

- [ ] 新 clone 后可完成 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`；`ci`、`spec-validate`、`test-guard` 三个 required check 在脚手架 PR 上真实转绿
- [ ] `pnpm test` 默认不收集 `acceptance/`；`pnpm acceptance` 只运行 `acceptance/**`
- [ ] 写死的单 Agent Cross-Agent Review IR 通过 L1 Schema 与 L2 图语义校验
- [ ] 非法 IR 返回包含 `node`、`edge`、`code`、`message` 键的结构化错误；可定位错误的对应 locator 非空
- [ ] 启动 run 后真实调用本地 Codex `app-server` adapter，而非 fixture、stub 或云 task
- [ ] run/node 状态按 PRD §10 允许的状态迁移推进并持久化
- [ ] `run_events` 在 SQLite 中以每 run 从 1 开始、无重复且无空洞的递增 `seq` append-only 持久化
- [ ] Codex final text 兜底保存为 `report` artifact，并能通过 `run_id` 与 `node_run_id` 溯源到产出节点
- [ ] Codex adapter 的事件归一化有基于真实录制 app-server JSONL 输出的表驱动测试
- [ ] Electron 薄壳窗口内的只读 React Flow 画布能看到按状态着色的节点、实时文本流和最终 artifact

## Non-goals

- 可视化编辑画布（P2）
- 多 Agent 并行、Claude Code/OpenCode adapter、MCP artifact 工具通道、`agent.reduce`（P3）
- Human Gate、受控环、失败恢复、重试策略、回放时间线（P4）
- NL→IR（P5）
- 云 task 通道与云执行基础设施（PRD §21）
