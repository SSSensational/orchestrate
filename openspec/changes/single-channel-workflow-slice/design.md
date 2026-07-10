# Design: 单通道 Agent Workflow 最小纵向切片

本 change 的技术形态几乎全部由 PRD 已取证的结论决定（PRD §2–§16 引用官方文档）。本文只记录 **Phase 1 的收窄取舍** 及其来源，不复述 PRD。

## 决策 1：第一个 adapter 走 Claude Code 原生无头通道

- **选择**：`claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode ...`，prompt 走 stdin 的 stream-json 帧（独立线程写入防 stdio 死锁），session id 从 `system`/`result` 事件捕获。
- **来源**：PRD §3.1 表（官方文档核实的三家 CLI 无头通道）与 §3.2 策略 B 的实测要点（claude 一行）。需求正文点名「首选 Claude Code 原生通道」。
- **理由**：策略 B（per-CLI 原生通道）比策略 A（ACP 社区适配器）更贴官方能力，且 Phase 1 只需一条最顺手通道跑通（PRD §3.2 取舍：「Phase 1 从一条最顺手的原生通道起步」）。
- **假设**：本机已安装并登录 Claude Code CLI；`probe()` 在执行前确认可用（PRD §14 L3 的雏形）。

## 决策 2：Phase 1 产出走 final text 兜底，不建 MCP 工具通道

- **选择**：`agent.run` 节点完成后，把 adapter `AgentResult.finalText` 存为 `report` 类 artifact，`node_run_id` 指向来源节点。
- **来源**：PRD §7「三级降级」第 3 条明示「兜底 final text 存为 report 类 artifact（Phase 1 先用这个跑通）」；PRD §19 Phase 1 描述「final text 兜底成 artifact」。
- **理由**：`emit_artifact` MCP 工具通道属 P2（Non-goal）。Phase 1 只需证明「产出可溯源到节点」，final text 兜底足够。`completed + 空 finalText` 是合法结果，但 Phase 1 的示例 prompt 会要求 agent 输出可见文本以便 UI 演示。

## 决策 3：事件归一化以真实录制 fixture 做表驱动测试

- **选择**：把一次真实 Claude Code 无头运行的 NDJSON 输出录制为 fixture，表驱动断言其归一化为期望的 `AgentEvent` 序列（`session` / `text_delta` / `tool_call` / `usage` / `raw` 兜底）。
- **来源**：PRD §6「事件流归一化」要点 + PRD §16「各 adapter 的事件归一化必须有表驱动单测」；PRD §2.5 教训（不要指望解析模型自由文本）。
- **理由**：事件格式随 CLI 版本漂移，录制 fixture 让归一化回归可判定；无法归类的事件走 `raw` 透传而非报错。

## 决策 4：持久化 = SQLite 6 表 + `run_events` 单一事实源

- **选择**：按 PRD §11 建 6 张表；`run_events(run_id, seq)` append-only、seq 每 run 严格递增、无空洞；Phase 1 实际写入 `workflow_runs` / `workflow_node_runs` / `agent_tasks` / `artifacts` / `run_events`（`workflow_definitions` 可选，示例 IR 可直接作为 run 的 `ir_snapshot_json` 冻结）。
- **来源**：PRD §11 数据模型、§12 事件日志、§15 调度算法。
- **理由**：一份 append-only 日志同时支撑实时流与（未来的）恢复/回放（PRD §12）。Phase 1 只用到「实时」这一能力，但表结构不为 demo 简化埋雷（PRD §17）。

## 决策 5：只读 UI 经 WebSocket + seq 消费实时流

- **选择**：后端 Hono 暴露 HTTP 启动 run + WebSocket 推送 `run_events`；断线可带 seq catch-up。UI 展示节点状态（颜色=状态）、agent 实时文本流、最终 artifact。
- **来源**：PRD §5 架构、§12 事件日志「实时：WS 推送；断线带 seq 重连补发」、§16 UI 布局。
- **理由**：Phase 1 是「只读」——不含画布编辑（P4）、不含 gate 表单（P3）。text_delta 按 ~500ms 批量落事件（PRD §15）以免 UI 过载。

## 决策 6：脚手架 task 先行且免验收测试

- **选择**：tasks.md 第一个 task 是工程脚手架 + 三个 required check 真实接线，本身不带 `acceptance/` 测试，靠 CI 判据（fresh-clone install/typecheck/lint/test 成功、ci 非空转）+ 人审兜底；D5 测试分离从第二个 task 起生效。
- **来源**：需求正文排序约束；决策 D5（vitest 默认排除 acceptance/、`pnpm acceptance` 单列、ci 增加 per-issue acceptance check `--grep "#<n>"`）。
- **理由**：`acceptance/**` 由 test-writer 从判据派生，但脚手架的判据是「工具链与门禁本身可运行」，天然由 CI 可观察状态证实，不需要独立测试文件。
