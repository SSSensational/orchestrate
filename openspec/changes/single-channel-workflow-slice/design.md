# Design: 单通道 Agent Workflow 最小纵向切片

## Context

仓库当前只有流程基建，没有 product workspace，也没有 `openspec/specs/**` living spec（D2 要求 greenfield 从空开始）。因此本 change 同时建立 `build-pipeline`、`workflow-ir`、`agent-adapter`、`run-execution`、`run-ui` 五个 capability；跨 capability 的行为合同暂由本 change 的对应 delta specs 定义，归档后才成为 living specs。

需求以 PRD §5–§16、§19 和 `docs/decisions.md` D14 为产品约束：P1 交付 Electron 薄壳桌面 app；壳只管理窗口、独立 server 子进程的生命周期与后续打包，业务逻辑留在可独立测试和浏览器调试的 Node orchestrator；第一条 adapter 固定为 Codex `app-server`；画布在 P1 只读。本 worktree 基线尚未包含 D14，仓库内取证来自本地 ref `origin/docs/electron-form-factor` 的提交 `ec4054f`；本 change 不越界修改 `docs/**`。

取证来源：

- 仓库内：`docs/PRD.md` §3.1/§3.2、§5–§16、§19；`docs/decisions.md` D5、D9，以及取证提交 `ec4054f` 中的 D14；`docs/constitution.md` 第 2、4、9、10 条。
- Codex 官方文档：[Codex App Server](https://developers.openai.com/codex/app-server/) 明确默认 stdio transport 使用逐行 JSON，连接必须先 `initialize`/`initialized`，再 `thread/start` 与 `turn/start`；运行期间以 `item/*` 通知流式输出，并以 `turn/completed` 给出终态。
- Electron 官方文档：[Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) 将窗口管理归于 main process，并建议通过受限 preload bridge 暴露能力；[Security](https://www.electronjs.org/docs/latest/tutorial/security) 要求 renderer 禁用 Node integration、启用 context isolation 并限制导航。
- React Flow 官方 API：[ReactFlow component](https://reactflow.dev/api-reference/react-flow) 提供 `nodesDraggable`、`nodesConnectable`、`elementsSelectable` 等显式只读交互开关。

## Goals / Non-Goals

**Goals:**

- 从写死 IR 到真实 Codex 调用、状态推进、SQLite 事件与 artifact、Electron 可视化形成一条可运行纵向链路。
- 让每个阶段都有确定性、可派生的判据；真实模型调用只用于本地 smoke/demo，不成为 CI 门禁。
- 保持 IR、执行、事件和 UI 的边界，使 P2 可在不改执行语义的前提下增加画布编辑。

**Non-Goals:**

- 不实现 P2 的画布编辑或 `ui_json` 持久化。
- 不实现 P3 的多 agent、其他 adapter、MCP artifact 工具通道或 reduce。
- 不实现 P4 的 gate、环、恢复、重试和回放时间线。
- 不实现云 task，也不把 Electron main process 变成业务运行时。

## Decisions

### 1. 先建立可运行脚手架，再拆分产品 capability

Task 1 一次性建立 `/shared`、`/server`、`/web`、`/desktop`、`/examples` 工作区、TypeScript strict、lint、vitest 测试分离、Electron 可启动骨架与三个 required check 的真实接线。它只交付工程地基，不伪造 workflow 行为；D5 的独立 test-writer 流程从 Task 2 开始。

后续 tasks 按 `workflow-ir` → `run-execution` store 与 `agent-adapter`（可并行取证但 change 内串行交付）→ orchestrator → realtime API → `run-ui` 排序。每个 task 对应一次 dispatch/PR，并引用相应 delta spec；`tasks.md` 只作为播种快照。

### 2. Codex adapter 只依赖 app-server stable API

`agent-adapter` spawn `codex app-server --listen stdio://`，每条 stdin/stdout 消息为一行 JSON-RPC。连接生命周期固定为：

1. `initialize`（带 client metadata）并等待成功响应，再发送 `initialized`；
2. `thread/start`，显式传入工作目录、`approvalPolicy: "never"` 与只读 sandbox；从响应的 `thread.sessionId` 捕获恢复指针；
3. `turn/start` 发送文本 input；把 `item/agentMessage/delta` 归一化为 `text_delta`，把 item/tool/usage 等稳定通知归一化为对应 `AgentEvent`，未知通知保留为 `raw`；
4. 以 `item/completed` 中最终 agent message 作为 final text 的权威值，以 `turn/completed` 判定 completed/failed；进程退出或协议错误必须显式失败，不能用“收到过文本”推断成功。

P1 不设置 `experimentalApi`，不实现 steer/resume/approval UI。只读 sandbox + `approvalPolicy: "never"` 避免无人值守 run 卡在审批请求；若 server 仍发起未支持的请求，adapter 必须拒绝并以结构化 failure 结束，不能自动扩大权限。此决定落实 `agent-adapter/spec.md`，并为 `run-execution/spec.md` 提供稳定的 session/text/result 输入。

CI 不启动真实模型：协议解析由脱敏后的真实 app-server JSONL 录制 fixture 做表驱动测试；另提供显式本地 live smoke 命令，它必须使用已安装、已登录的 Codex，运行真实示例 prompt 并输出 session id、增量文本和终态。fixture/fake adapter 只用于确定性测试，不得满足“真实调用”验收项。

### 3. Electron 是薄壳，renderer 与 orchestrator 通过 loopback HTTP/WS 通信

`desktop` main process 只创建一个 `BrowserWindow`、启动/监督独立 `server` 子进程、在 app 退出时终止子进程，并加载本地构建的 React renderer；orchestrator、validator、SQLite 与 adapter 均不进入 Electron main process。renderer 设置 `nodeIntegration: false`、`contextIsolation: true`，不暴露通用 IPC、shell 或 filesystem API，并拒绝非应用内导航。

开发时 `/web` 可直接由浏览器连接同一 Hono API；桌面窗口复用相同前端。server 只绑定 loopback 地址，启动后向 parent 报告实际端口；Electron 将该 origin 作为只读启动配置传给 renderer，避免固定端口冲突。此决定同时约束 `build-pipeline/spec.md` 的 shell 骨架和 `run-ui/spec.md` 的最终桌面行为。

### 4. SQLite 事务同时提交状态与事件，run_events 由数据库阻止改写

`run-execution` 按 PRD §11 建 6 张表。每次状态迁移在单个 SQLite transaction 内更新 run/node/task 行并 append 对应 `run_events`；下一个 `seq` 在该 transaction 内按当前 run 分配，从 1 开始且无重复、无空洞。`run_events` 对 `(run_id, seq)` 建主键，并用 SQLite triggers 拒绝 UPDATE/DELETE，从数据库层证明 append-only，而不只依赖调用约定。

final text 在节点完成的同一事务中写为 `report` artifact，并通过 `run_id`、`node_run_id` 指向来源；随后 append `artifact_emitted` 与完成事件。UI 只消费持久化事件和读 API，不直接订阅 adapter 内存流。此决定落实 `run-execution/spec.md`，并向 `run-ui/spec.md` 提供唯一事实源。

### 5. P1 React Flow 只呈现运行状态，不产生 IR

`run-ui` 将写死 IR 映射为 React Flow nodes/edges，并设置 `nodesDraggable={false}`、`nodesConnectable={false}`、禁止删除/新增；viewport 的 pan/zoom 可以保留，但任何交互都不能改变 IR。每个 PRD §10 node 状态有稳定的视觉 token（颜色并辅以文本标签，避免只靠颜色传达）。

Hono 提供启动 run、读取 snapshot/artifact 和 WebSocket 事件流；WS 客户端携带最后确认的 `seq`，server 先补发缺失事件再转 live。renderer 以相同的 event reducer 更新节点状态、文本和 artifact，确保断线重连结果与连续连接一致。此决定落实 `run-ui/spec.md`，不提前实现 P2 authoring。

## Risks / Trade-offs

- **[app-server 协议随 Codex CLI 版本演进]** → 仅依赖官方 stable API；记录 fixture 的 CLI 版本；未知通知走 `raw`；协议错误 fail closed；fixture 更新必须经独立测试 PR 规则处理。
- **[CI 无法证明本机账号已登录并能调用模型]** → CI 证明 parser/orchestrator 的确定性合同，本地 live smoke 证明真实通道；两类证据在 task 判据中分开，禁止用 fake 替代 live 证据。
- **[Electron/renderer 扩大本地权限面]** → renderer 不启用 Node integration，保持 context isolation，不暴露通用 IPC；server 只监听 loopback，业务能力仍受 orchestrator 权限策略约束。
- **[SQLite 原生依赖增加 Electron 打包复杂度]** → better-sqlite3 只加载在独立 Node server 进程，Electron main/renderer 不直接引用；P1 只要求从 checkout 可运行，不把跨平台安装包签名纳入范围。
- **[高频 text delta 导致写放大]** → adapter 保持原始增量语义，orchestrator 按约 500ms 批量写 `agent_text_delta`；终态 final text 仍以完成 item 为准。
- **[颜色状态难以自动/无障碍验证]** → 节点同时提供机器可读 `data-status` 与可见状态文本，E2E 断言语义状态和对应 style token。

## Migration Plan

这是 greenfield change，无数据迁移与兼容负担。按 tasks 顺序逐 PR 引入；任一中间 PR 必须保持当时已有命令全绿，不以 stub 声称后续 capability 已完成。若某 task 回滚，只回滚该 issue 的 PR；SQLite schema 在 P1 尚无已发布用户数据，必要时删除开发数据库并重建。

## Open Questions

无阻塞问题。Codex 具体版本不在 spec 中钉死；实现需记录生成真实 fixture 时的 `codex --version`，并以当前官方 stable protocol 为准。
