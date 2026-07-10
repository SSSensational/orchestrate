# Tasks: 单通道 Agent Workflow 最小纵向切片

> 有序顶层任务，每条约半天、可独立 dispatch、可独立开 PR。播种成 GitHub Issues 后此文件不再维护（活状态只看 Issues）。
> **顺序即依赖**：Task 1 是所有 issue 的地基（脚手架）；Task 2→3 递进；Task 6 依赖 3/4/5；Task 7 依赖 6。同 change 串行（D6）。

## 1. 工程脚手架与三个 required check 真实接线（capability: build-pipeline）

> 允许无 `acceptance/` 测试先行——判据由 CI 可观察状态 + 人审证实（D5 测试分离从 Task 2 起生效）。

- [ ] pnpm workspace 建立 `/shared`、`/server`、`/web`、`/examples`（PRD §16）
- [ ] TS strict、eslint、vitest 就位；`pnpm typecheck`/`pnpm lint`/`pnpm test` 均可跑
- [ ] vitest 默认排除 `acceptance/`；`pnpm acceptance` 单列运行 `acceptance/**`
- [ ] ci 增加 per-issue acceptance check（`--grep "#<n>"`，D5）的接线（可先空跑但脚本存在）
- [ ] 新 clone 后 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` 全绿
- [ ] `ci` 不再空转：product source 存在后真实执行 typecheck/lint/test；type error 会让 ci 变红
- [ ] `spec-validate`、`test-guard` 在 CI 真实转绿
- [ ] 更新 AGENTS.md「命令」节由 initializer 会话完成（属人审区，本 task 不改 docs/**）

## 2. Canonical IR 类型 + L1 Schema 校验 + 结构化错误 + 示例 IR（capability: workflow-ir）

- [ ] `/shared` 定义 `agent.workflow/v1` 的 zod schema 与 TS 类型（扁平 nodes/edges、snake_case，PRD §8）
- [ ] L1 校验：zod 校验、未知字段拒绝
- [ ] 结构化错误类型 `{ node?, edge?, code, message }[]`，L1 错误按此形状返回
- [ ] `/examples` 落一份写死的单 Agent、无环 Cross-Agent Review 示例 IR
- [ ] 示例 IR 通过 L1 校验（零错误）
- [ ] 加未知字段的 IR → L1 失败且错误列表非空

## 3. L2 图语义校验（capability: workflow-ir）

- [ ] id 唯一；边端点存在；无不可达节点（PRD §14 L2）
- [ ] 模板引用 `{{nodes.<id>.artifacts.<name>}}` 可解析到上游 `output_artifacts`
- [ ] `agent` 存在且节点 capability 要求 ⊆ adapter capabilities
- [ ] 示例单 Agent IR 通过 L2 校验（零错误）
- [ ] 悬空边的 IR → L2 失败，错误定位到该 edge
- [ ] 不可解析模板引用的 IR → L2 失败，错误定位到该 node

## 4. SQLite 持久化层 + run_events append-only（capability: run-execution）

- [ ] better-sqlite3 建 PRD §11 的 6 张表（workflow_definitions/runs/node_runs/agent_tasks/artifacts/run_events）
- [ ] `run_events(run_id, seq)` 主键；写入 append-only，seq 每 run 从 1 严格递增、无空洞
- [ ] artifacts 表可写入并按 run_id / node_run_id 读取
- [ ] 提供 append 与按 seq 读取的最小 store API（供 Task 6 使用）
- [ ] 单元/集成测试覆盖 seq 递增无空洞、append-only（不改写既有行）

## 5. Claude Code 本地 adapter + 事件归一化表驱动测试（capability: agent-adapter）

- [ ] 定义 `AgentAdapter` 接口、`AgentEvent` 联合、`AgentResult`（PRD §6）于 `/shared`
- [ ] 实现 Claude Code 原生通道 adapter：`claude -p --output-format stream-json --input-format stream-json`（PRD §3.2）
- [ ] prompt 走 stdin stream-json 帧（独立线程写入防死锁）；session id 一出现即捕获
- [ ] `probe()` 确认 CLI 可用并返回 version
- [ ] 事件流归一化为 `AgentEvent`（session/text_delta/tool_call/usage）；无法归类走 `raw`，不抛错
- [ ] 录制一份真实 Claude Code 无头输出为 fixture
- [ ] 表驱动测试：fixture → 期望 `AgentEvent` 序列相等；未知行落 `raw`

## 6. Orchestrator 状态机 + 单节点执行 + final text 兜底 artifact（capability: run-execution）

- [ ] 启动 run：冻结 `ir_snapshot_json`；节点置 pending（PRD §15）
- [ ] 状态机推进 run（created→running→completed/failed）与 node（pending→ready→running→completed/failed，PRD §10）
- [ ] 调度就绪的 `agent.run` 节点：建 agent_task → adapter.execute（workspace/permissions 映射）
- [ ] 消费事件流：session id 持久化；text_delta 批量（~500ms）落 run_events；run/node 生命周期事件落库
- [ ] 节点完成后 adapter `finalText` 存为 `report` artifact，`node_run_id` 指向来源节点
- [ ] 端到端：跑示例单 Agent IR → run 达 completed、run_events 连续、report artifact 可溯源
- [ ] adapter 返回 failed → node failed、run failed 且 error_json 非空

## 7. 只读 Web UI：节点状态 + 实时流 + 最终 artifact（capability: run-ui）

- [ ] Hono 暴露启动 run 的 HTTP 入口 + WebSocket 推送 run_events（PRD §5/§12）
- [ ] Vite + React 只读视图：节点状态指示（颜色=状态），随 run 进展从 running→completed
- [ ] agent 实时文本流随 `text_delta` 事件增量显示
- [ ] 完成后展示最终 `report` artifact 并归属到节点
- [ ] 断线带最后 seq 重连补发，重连后状态与未断连一致
- [ ] 不含画布编辑 / gate 表单 / 回放时间线（P3/P4 Non-goal）
