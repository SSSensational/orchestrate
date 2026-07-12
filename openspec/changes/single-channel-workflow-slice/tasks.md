# Tasks: 单通道 Agent Workflow 最小纵向切片

> 每个编号标题是一条将被播种成独立 GitHub Issue 的顶层任务；标题下 checklist 是该 issue 的验收判据。顺序即依赖，同 change 串行。播种后本文件不再维护，活状态只看 Issues。

## 1. 工程脚手架、Electron 薄壳骨架与三个 required check 真实接线（build-pipeline）

> 本任务是所有后续任务的地基，按需求特例允许没有预先存在的 `acceptance/` 测试；验收以确定性 CI 结果、desktop smoke 和人审为准。

  - [ ] 建立 pnpm workspace：`shared`、`server`、`web`、`desktop`、`examples`，提交 lockfile 并声明 Node.js 22/pnpm 版本
  - [ ] 建立根级 TypeScript strict、lint、vitest 配置；`pnpm typecheck`、`pnpm lint`、`pnpm test` 均真实覆盖已有 product workspaces
  - [ ] `pnpm test` 不收集 `acceptance/**`；`pnpm acceptance` 只收集 `acceptance/**`
  - [ ] Electron `desktop` 可启动一个加载本地 `web` root 的 BrowserWindow 并正常退出；renderer 为 `nodeIntegration: false`、`contextIsolation: true`，main process 不含 workflow 业务逻辑
  - [ ] 新 clone 执行 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` 全部退出 0
  - [ ] `ci` 删除 no-source/vacuous-success 分支，脚手架 PR 上真实执行 frozen install、typecheck、lint、test
  - [ ] 脚手架 PR 上 required checks `ci`、`spec-validate`、`test-guard` 全部真实转绿；引入 product type error 可使 `ci` 确定性失败

## 2. Canonical IR 类型、L1 Schema、示例 IR 与错误合同（workflow-ir）

  - [ ] `shared` 定义 strict zod schema 与推导 TS 类型，版本固定为 `agent.workflow/v1`，未知字段拒绝
  - [ ] `examples` 提交一份写死的单 Agent、无环 Cross-Agent Review IR，不含 P2+ 节点或交互
  - [ ] 示例 IR 原样通过 L1 且零错误；节点增加未知字段后 L1 确定性失败
  - [ ] 公开错误对象统一含 `node`、`edge`、`code`、`message` 四个键，locator 可空而 code/message 必为非空字符串
  - [ ] test-writer 从 workflow-ir/spec.md 的 L1 与结构化错误 scenarios 派生的独立验收套件全部转绿

## 3. Phase 1 L2 图语义校验（workflow-ir）

  - [ ] 校验 node id 唯一、edge 端点存在、所有节点从 root 可达
  - [ ] 校验模板引用只指向传递上游节点已声明的 `output_artifacts`
  - [ ] 校验 IR 引用的 agent 存在且 node 要求不超出 registry capabilities
  - [ ] 示例 IR + Codex registry 通过 L2 且零错误
  - [ ] duplicate id、dangling edge、unreachable node、unresolved template、missing capability 各返回稳定 code 和正确非空 locator
  - [ ] 相同非法输入重复校验返回深度相等且顺序一致的错误列表
  - [ ] test-writer 从 workflow-ir/spec.md 的 L2 scenarios 派生的独立验收套件全部转绿

## 4. SQLite 六表、状态存储与 append-only run_events（run-execution）

  - [ ] better-sqlite3 初始化 PRD §11 六张表并在连接上启用 foreign keys
  - [ ] 创建 run 时先提交不可变 `ir_snapshot_json`，调用方随后修改内存对象不影响快照
  - [ ] store API 以单 transaction 提交状态变化及对应事件；每 run 的 seq 从 1 开始逐一递增且互相独立
  - [ ] `(run_id, seq)` 主键阻止重复；SQLite triggers 阻止已有 `run_events` 的 UPDATE 与 DELETE
  - [ ] artifact 可按 `run_id`、`node_run_id` 写入和读取，并保持外键 provenance
  - [ ] test-writer 从 run-execution/spec.md 的 schema、snapshot、seq 与 append-only scenarios 派生的独立验收套件全部转绿

## 5. Codex app-server 原生 adapter 与真实录制归一化测试（agent-adapter）

  - [ ] `shared` 定义 Phase 1 所需 `AgentAdapter`、`AgentEvent`、`AgentResult` 强类型合同
  - [ ] adapter `probe()` 返回本地 Codex 可用性与非空版本，execute spawn `codex app-server --listen stdio://`
  - [ ] 严格完成 `initialize`/`initialized` → `thread/start` → `turn/start`，使用 read-only sandbox 与 `approvalPolicy: never`，捕获响应中的 `thread.sessionId`
  - [ ] `item/agentMessage/delta`、完成 message、tool/usage、`turn/completed` 被归一化；未知通知走 `raw`，协议/进程错误显式 failed
  - [ ] 未支持的 server request 不获授权、不挂起，返回非空 failure reason
  - [ ] 提交一份脱敏的真实 Codex app-server JSONL 录制 fixture，metadata 含录制时 `codex --version` 且不含 token、用户路径、remote URL 或非 smoke prompt
  - [ ] 表驱动测试逐例断言 fixture → 精确 `AgentEvent[]` + `AgentResult`，未知通知 fallback 也被覆盖
  - [ ] 显式本地 live smoke 命令在已安装、已登录 Codex 的机器上真实 spawn app-server，观察到 session、text_delta、completed 与非空 finalText；fixture/fake 不得满足此项
  - [ ] test-writer 从 agent-adapter/spec.md 派生的确定性验收套件与本地 live smoke 全部转绿

## 6. Orchestrator 单节点状态机与 final-text artifact 纵向执行（run-execution）

  - [ ] 实现 run `created→running→completed|failed`、node `pending→ready→running→completed|failed`、agent task 终态迁移表；非法迁移不改状态、不写伪事件
  - [ ] 启动 run 冻结 IR、创建 pending node、判定 ready、创建 agent task 并调用 registry 中的 Codex adapter
  - [ ] session 捕获与约 500ms 聚合的 text delta 写入 run_events；所有生命周期事件与状态在同 transaction 提交
  - [ ] 非空 finalText 在 node completed 前保存为唯一 `report` artifact，`run_id`/`node_run_id` provenance 正确并先写 `artifact_emitted`
  - [ ] adapter failed 时 task/node/run 均 failed，持久化非空 failure reason/error data
  - [ ] 确定性集成测试覆盖成功、失败、非法迁移、事件因果顺序与 artifact provenance
  - [ ] 本地 workflow live smoke 用示例 IR 经 orchestrator registry 真实调用 Codex app-server，最终得到 completed run、连续事件与可溯源 report；fixture/fake 不得满足此项
  - [ ] test-writer 从 run-execution/spec.md 的状态机与 artifact scenarios 派生的独立验收套件全部转绿

## 7. Hono run API、持久化 WebSocket 流与 seq catch-up（run-ui）

  - [ ] Hono server 只绑定 loopback，暴露启动 bundled workflow、读取 run snapshot、读取 artifacts 的最小 HTTP API
  - [ ] WebSocket 从 SQLite `run_events` 推送而非直接透传 adapter 内存事件，消息携带 run id 与 seq
  - [ ] 首次从 `after_seq=0` 订阅按递增 seq 收到事件，内容与 SQLite 行一致
  - [ ] 断线后以最后确认 seq 重连时先按 `K+1...N` 精确补发、无丢失无重复，再进入 live
  - [ ] server 启动向父进程输出结构化 readiness（loopback host + 实际端口），正常终止时关闭 WS 与数据库
  - [ ] test-writer 从 run-ui/spec.md 的 realtime API scenarios 派生的独立验收套件全部转绿

## 8. Electron 内只读 React Flow 画布、实时流与 artifact（run-ui）

  - [ ] Electron main 启动一个独立 Node server 子进程，收到 readiness 后再打开一个窗口；app 退出在 grace period 内终止子进程并释放端口
  - [ ] web renderer 可在浏览器独立调试，并在 Electron 中通过同一 HTTP/WS 合同连接 server；Electron main 不导入 validator/orchestrator/adapter/store
  - [ ] React Flow 渲染示例 nodes/edges，禁止拖动、新增、删除、重连与保存 IR；pan/zoom 不改变 IR
  - [ ] 节点同时显示状态文本、稳定颜色 token 与 `data-status`，运行中按持久化事件从 running 更新为 completed
  - [ ] 实时面板按 seq 增量且不重复显示 agent text；重连 catch-up 后与不断线客户端状态完全一致
  - [ ] artifact 面板显示完整 report，并显示与数据库一致的 artifact id、run id、产出 node/node-run provenance
  - [ ] UI 中不存在画布 authoring、human gate、retry/recovery 或 replay timeline 控件
  - [ ] Electron E2E 覆盖薄壳进程生命周期、画布只读、状态更新、实时文本、artifact 与重连收敛 scenarios
  - [ ] 在已安装、已登录 Codex 的本机从 Electron 点击 Run，可观察真实节点完成、实时文本和最终 report；录屏/日志可区分真实 app-server 进程与测试 fixture
  - [ ] test-writer 从 run-ui/spec.md 的 Electron/React Flow scenarios 派生的独立验收套件全部转绿
