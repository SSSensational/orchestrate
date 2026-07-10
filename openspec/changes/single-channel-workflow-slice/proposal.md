# Proposal: 单通道 Agent Workflow 最小纵向切片

## Why

当前仓库只有流程基建（OpenSpec、CI 门禁、本地 CLI 派发脚本），没有任何可运行的产品代码——living specs 按 D2 从空开始。要证明 PRD §0 的核心命题（「coding agent 会话可被当作 workflow 节点编排」「workflow 是可校验、可观察的数据」），必须先交付第一个端到端可运行的纵向切片。

本 change 交付 PRD §19 **Phase 1** 的可展示 checkpoint：一份写死的、单 Agent、无环的 Cross-Agent Review IR，经 L1 Schema + L2 图语义校验、经第一个本地 coding-agent adapter 执行、状态机推进、事件 append-only 落 SQLite，最终在只读 UI 中呈现节点状态、实时文本流与结果 artifact。

排序约束（Why 的一部分）：Phase 1 的**第一个 task 必须是工程脚手架**（pnpm workspace + TS strict + vitest 测试分离 + lint + 三个 required check 真实接线）。它是后续一切 issue 的地基，也是让 `ci` 从「无 package.json 时空转通过」变为真实执行的前提。测试作者/实现者分离（D5）从第二个 task 起才生效——脚手架 task 本身允许无验收测试先行，靠 CI 判据 + 人审兜底。

## What Changes

- **新增 capability `build-pipeline`**：pnpm 工作区、TS strict、eslint、vitest（默认排除 `acceptance/`，`pnpm acceptance` 单列）、`ci`/`spec-validate`/`test-guard` 三个 required check 真实转绿（不再空转）。
- **新增 capability `workflow-ir`**：Canonical IR（`agent.workflow/v1`）的 zod 类型与 L1 Schema 校验、L2 图语义校验、结构化错误（`{ node?, edge?, code, message }[]`）；附一份写死的单 Agent Cross-Agent Review 示例 IR。
- **新增 capability `agent-adapter`**：第一个 AgentAdapter，走 Claude Code 原生无头通道，spawn 本地会话、归一化事件流为 `AgentEvent`、捕获 session id；事件归一化有基于真实录制输出的表驱动测试。
- **新增 capability `run-execution`**：Orchestrator 按 PRD §10 状态机推进 run/node；6 张表的 SQLite 存储；`run_events` 以递增 `seq` append-only 持久化；adapter final text 兜底存为 `report` artifact 并可溯源到 node_run。
- **新增 capability `run-ui`**：只读 Web UI，展示节点状态、agent 实时文本流、最终 artifact。

不改动 `openspec/changes/` 以外的任何东西（本 change 仅新增提案与 spec delta；实现由播种后的 issue 完成）。

## Impact

- **影响的 capabilities**：`build-pipeline`、`workflow-ir`、`agent-adapter`、`run-execution`、`run-ui`（均为本仓库首次建立，living spec 从空到有）。
- **代码影响面**：建立 `/shared`、`/server`、`/web`、`/examples` 工作区（PRD §16 仓库结构）；引入 better-sqlite3、zod、Hono、Vite+React 依赖；`package.json` 出现后 `ci` 变为真实执行。
- **门禁影响**：脚手架 task 让三个 required check 真实转绿；此后 `acceptance/**` 由 test-writer 拥有（D5），本 change 的实现 issue 从第二个起适用测试分离。
- **风险**：Claude Code 原生通道的事件格式若随版本漂移，adapter 归一化需以录制 fixture 兜底（见 design.md）；本地 CLI 需已登录可用（`probe()` 前置）。

## 验收判据（成果级；提案在 tasks.md 与 specs 细化到可判定）

- [ ] 新 clone 后 pnpm 可完成 install、typecheck、lint、test；`ci` / `spec-validate` / `test-guard` 三个 required check 在 CI 真实转绿（不再空转）
- [ ] `pnpm test` 默认排除 `acceptance/`；`pnpm acceptance` 可独立运行
- [ ] 示例单 Agent IR 通过 L1 Schema 与 L2 图语义校验
- [ ] 非法 IR 返回包含 node/edge/code/message 的结构化错误
- [ ] 启动 run 后真实调用一个本地 coding-agent adapter（Claude Code 原生通道）
- [ ] run / node 状态按 PRD §10 状态机推进
- [ ] `run_events` 以递增 seq append-only 持久化到 SQLite
- [ ] adapter final text 兜底保存为 artifact，可溯源到节点
- [ ] adapter 事件归一化有基于真实录制输出的表驱动测试
- [ ] 只读 UI 可看到节点状态、实时文本流和最终 artifact

## Non-goals

- 多 Agent 并行；跨厂商同图协作（P2）
- MCP artifact 工具通道（`emit_artifact` / `get_context` + task-scoped token，P2）
- `agent.reduce` 节点；失败重试（attempt / failure_reason / 带毒判定，P2）
- Human Gate、受控环、失败恢复、回放时间线（P3）
- 可视化编辑（React Flow 增删改、ui_json sidecar，P4）
- NL→IR（P5）
- 云 task 通道与云执行基础设施（PRD §21）
