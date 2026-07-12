# Agent Workflow Runtime — 项目蓝图

## 0. 一句话目标

> 做一个可视化、可生成、可验证、可回放的 Agent Workflow Runtime：自然语言和画布都只是 authoring surface，最终生成同一份 Canonical IR；Runtime 依据 IR 并行调度**完整的本地 coding agent 会话**（Claude Code / Codex / OpenCode 等真实 CLI）；全过程沉淀为 append-only 事件日志和结构化 artifacts，支持暂停、恢复、回放。

要证明三件事：

1. **coding agent 会话可以被当作 workflow 节点编排**——不是聊天串联，不是调 LLM API 的 prompt chaining，而是驱动会读写真实工作目录/仓库、调用真实工具、跑几分钟到几十分钟的完整 agent。
2. **workflow 是数据**（Canonical IR + node run + event + artifact），可校验、可观察、可回放，执行路径确定。
3. 架构能从单机 demo 平滑演进到更重的形态（第 17 节差距清单），但 demo 不背生产包袱。

读者只需这一份文档即可理解"造什么"：动机、参考调研结论、agent 集成通道、接口定义、IR 规范、数据模型、状态机、调度算法、校验规则、实施路线、验收标准，全部在文内。"怎么造"（AI-native 构建方法论）见同目录 `ai-native-build.md`。

## 1. 动机：为什么 multi-agent chat 不是编排

业界对 AutoGen / CrewAI 类会话式多 Agent 框架的一致批评：编排是"会话的涌现属性"——消息历史越长越难推理，agent 无界往返导致成本失控，状态不可检查、错误处理粗糙、无法回放。图式编排的优势正是：**workflow 是可校验、可 checkpoint、可回放的数据**，执行路径确定。

本项目站在图式编排一边，且比"代码即图"（LangGraph / Mastra）更进一步：用声明式 JSON IR 作为唯一可执行表示（理由见 §2.4 的 durable execution 论证）。同时，编排的执行单元不是 LLM API 调用，而是完整的 coding agent 会话——这是与 Dify 类平台的本质差异（见 §3）。

## 2. 参考框架调研（官方文档）

### 2.1 Dify：可视化 workflow 平台的 IR 长什么样

- **可执行表示**：YAML DSL。顶层 `app` 元数据 + `workflow.graph`，graph 是两个扁平数组 `nodes[]` 和 `edges[]`。节点带 `id`、`type` 和类型化的 `data`；边带 `source/target` 和 `sourceHandle/targetHandle`（命名端口，if-else 分支出口靠它）。**但节点上同时带 `position` 画布坐标**——布局和执行语义混在同一份文档里，画布即事实源。
- **数据传递**：变量制。每个节点输出成为命名变量，下游用 `{{node.variable}}` 引用；**并行分支之间互相不可见**，汇合点之后才都可读——规则隐式，靠使用者记住。并行有硬限制且有同步 bug 记录。
- **Human-in-the-loop**：Human Input 节点暂停运行，把表单送达；**每个操作按钮路由到一条不同的出边**，外加超时分支。
- **本项目取舍**：借鉴扁平 nodes/edges + 类型化 data + 命名端口（简单、可 diff、LLM 好生成）和 Human Input 的"按钮=命名出边+超时分支"；避免画布坐标混进 IR、避免隐式的变量可见性规则（数据依赖必须是显式边）。

### 2.2 LangGraph：checkpoint 一个原语撑起四个能力

- **可执行表示**：代码。`StateGraph` 用 `add_node/add_edge/add_conditional_edges` 构建再 `compile(checkpointer=...)`。全图共享一个 state 对象，每个 key 可配 reducer 定义并行写入合并语义。
- **持久化**：checkpointer 在**每个 super-step** 存快照。这一个机制同时支撑：会话记忆、容错、human-in-the-loop、time-travel。
- **HITL**：节点内 `interrupt(payload)` 暂停，外部 `Command(resume=value)` 恢复——**但恢复时整个节点函数从头重跑**，`interrupt()` 之前的代码必须幂等。文档明示的陷阱。
- **本项目取舍**：借鉴"一个持久化原语解决恢复+HITL+回放"（本项目用 append-only 事件日志达成）和流式的"节点增量 vs 全量状态"区分；避免共享 state + reducer 的复杂度（用命名空间 artifact 传递）和 interrupt 幂等陷阱（暂停只发生在节点边界）。

### 2.3 Mastra：step 的 schema 契约

- 每个 step 声明 zod 的 `inputSchema/outputSchema`；**可暂停的 step 额外声明 `suspendSchema`（暂停时人看到什么）和 `resumeSchema`（恢复时必须提交什么）**。
- **并行合并**：`.parallel()` 各分支输出**按 step id 归并成对象**——可序列化、无歧义，没有共享 state 合并问题。
- **本项目取舍**：借鉴四 schema 契约（human gate 在 JSON IR 里的正确形状）和按节点 id 命名空间归并。

### 2.4 Temporal / Inngest：durable execution 的本质（本项目核心论证）

- **Temporal**：每个 workflow 执行 = 一份不可变的**事件历史**。恢复 = worker 从头重放代码，SDK 用历史满足每个 await。代价：workflow 代码必须**确定性**，改在途代码触发非确定性错误。
- **Inngest**：`step.run(id, fn)` 的结果按 step id 哈希**记忆化**；每次重入跳过已完成 step、注入缓存结果、执行下一个新 step。
- **关键结论**：durable execution 的最小内核 = **append-only 运行日志 + 重遍历时跳过已完成节点、注入记忆化输出**。命令式代码需要确定性纪律，而**显式 DAG IR 本身就是确定性控制流**——回放只是对着日志重走图，不需要 Temporal 的确定性税。这是"后端只执行 Canonical IR"的根本理由。

### 2.5 n8n 生态：LLM 生成 workflow 的校验教训

- 社区专门造了加载真实引擎做逐节点校验的 validator，因为 **JSON Schema 校验拦不住 LLM 的语义错误**：幻觉出的空配置、连接指向不存在的节点、非法属性名。
- **本项目取舍**：Validator 必须分层（schema → 图语义 → 引擎级）；LLM 生成走"生成 → 校验 → 结构化错误回喂 → 修正"循环。

### 2.6 Claude Code Dynamic Workflows：内核判断的厂商级旁证

- **形态**：模型写一段 JS 编排脚本（`agent()` / `pipeline()` 原语），隔离 runtime 后台执行，至多 16 并发、单次 1000 agent 上限，中间结果留在脚本变量里（"the script holds the plan"）。
- **对 §2.4 的意义**：其 journal + resume（未变更前缀的 agent 调用直接命中缓存、只重跑其后）正是「append-only 运行日志 + 记忆化重遍历」——本项目的内核推导被厂商以另一形态发货验证。
- **本项目取舍（点名它，差异化才立得住）**：它是单厂商、编排 subagent 而非完整异构 coding CLI 会话；脚本是一次性命令式产物而非可校验的声明式 IR；无 Validator 分层、无画布与 sidecar、无回放 UI、无 human.gate 节点类型。本项目吸收其「journal 即事实源」的印证，坚持声明式 IR + 跨厂商。

## 3. 核心命题：编排的对象是完整 coding agent 会话

这是本项目与 Dify / LangGraph 类框架的本质差异。workflow 节点执行的不是一次 LLM API 调用，而是一个完整的 agent 会话：agent 在真实工作目录/仓库里读代码、跑命令、改文件、调 MCP 工具。要编排它们，必须先回答"每个 agent 怎么被程序化驱动"。

Orchestrator 在本机 spawn CLI 进程（无头 NDJSON/JSONL 流、官方 SDK、或 ACP 协议），事件流粒度细（token 级）、能力全（结构化输出、fork）、零网络依赖。

### 3.1 三个 CLI 的官方本地通道（官方文档核实）

| | Claude Code | Codex CLI | OpenCode |
|---|---|---|---|
| **无头进程通道** | `claude -p --output-format stream-json --input-format stream-json`（NDJSON 双向） | `codex exec --json`（JSONL：thread/turn/item 事件） | `opencode run --format json`（NDJSON） |
| **官方 SDK / 嵌入接口** | Agent SDK：`query()`、`canUseTool` 权限回调、hooks、`interrupt()` | `codex app-server`（JSON-RPC over stdio）；`@openai/codex-sdk` | `opencode serve`（REST + SSE）+ `@opencode-ai/sdk` |
| **会话恢复 / fork** | `--resume <id>` / `--fork-session`（按 cwd/worktree 作用域） | `thread/resume` / `thread/fork`；`codex exec resume <id>` | `--session <id>` / `--fork`；server 模式 session CRUD |
| **权限模型** | `--permission-mode` + `--allowedTools/--disallowedTools`；SDK `canUseTool` 进程内同步回调 | `--sandbox`（read-only/workspace-write/danger-full-access）× `--ask-for-approval`；**exec 无审批通道** | 配置规则（read/edit/bash/webfetch = allow/ask/deny）；server 模式 `ask` 变 SSE 权限事件 |
| **结构化输出** | `--json-schema`（落 `structured_output`）；SDK `outputFormat` | `--output-schema <path>` | **无** schema 约束输出 |
| **MCP 注入** | `--mcp-config <file\|json>` + `--strict-mcp-config` | `config.toml [mcp_servers]` | `opencode.json` `mcp` 配置 |
| **沙箱** | 无 OS 级（靠权限规则） | **有** OS 级沙箱模式 | 无（靠权限规则） |
| **ACP** | 仅社区适配器 | 仅社区适配器 | **原生**（`opencode acp`） |

2026-H1 各家还内置了原生并行 / 循环能力（编排时既是可利用通道、也是竞争参照）：Claude Code——后台 subagent 默认化、原生 worktree（`claude -w`）、agent teams（实验性：共享任务列表 + agent 互发消息）、Dynamic Workflows（§2.6）；Codex——subagents（2026-03 GA）、Goal mode（`/goal` 循环至目标，2026-05 转正）、本地↔云 thread handoff。含义：单厂商内的「并行 + 循环」已是内置能力，本项目命题在**跨厂商 + workflow-as-data**。

### 3.2 两种集成策略（生产系统源码验证）

**策略 A —— ACP 统一协议**（Agent Client Protocol，agentclientprotocol.com：把"客户端 ↔ coding agent"标准化的开放协议，JSON-RPC 2.0 over stdio，Zed 发起）。所有 CLI 收敛到 ACP：每个 agent = `cli_path + acp_args + env` 三元组，spawn 后 `initialize → session/new|load → session/prompt`，进度经 `session/update` 流回。原生不支持的套适配器。一套代码路径处理所有 agent 的会话/流/权限/MCP；权限是协议自带的交互回路（`session/request_permission`）。代价：Claude/Codex 走社区适配器，滞后官方能力。

**策略 B —— per-CLI 原生通道**（无头任务队列）。单方法接口 `Backend.Execute(ctx, prompt, opts) → Session{Messages 流, Result}`，每个 CLI 各自实现，差异在 backend 内归一。实测要点（每条都是集成时的坑）：

- **claude**：`claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode ...`；prompt 走 **stdin 的 stream-json 帧**（独立线程写入防 stdio 死锁）；session id 从 `system`/`result` 事件捕获；`control_request` 自动应答；MCP 写临时文件传 `--mcp-config`。
- **codex**：`codex app-server`，JSON-RPC `initialize → thread/start|resume → turn/start`；自动 accept 审批 RPC；MCP 写 `config.toml` 标记块；usage 兜底扫 sessions jsonl。
- **opencode**：`opencode run --format json --session SID`；**退出码 0 也可能失败**，必须以 error 事件为准；MCP 走环境变量；cwd 要同时设 `--dir`、进程 cwd、`PWD`。
- 共性：**预设 auto-approve 非交互执行**——安全靠工作目录隔离 + 沙箱；**产出走工具通道**（agent 调注入的 MCP 工具主动回报，completed + 空输出是合法结果）；resume 失败自动退回新会话；取消 = SIGTERM → 宽限 → SIGKILL 进程组。

**取舍**：AgentAdapter 接口设计成对上层透明（§6），A、B 均可挂进 registry。Phase 1 从 Codex 原生通道（app-server）起步；能力由 capability 声明暴露给 Validator。

## 4. 设计原则（不可妥协）

1. 自然语言不能直接执行；LLM 生成的 IR 必须过 Validator。
2. 画布不是执行源；UI 布局存 sidecar；后端只执行 Canonical IR。
3. Agent 产出优先走**工具通道**（注入的 `emit_artifact` MCP 工具），其次结构化输出，最后才是文本解析（生产教训：不要指望解析模型自由文本）。
4. 每个节点有显式状态机；每次运行有 append-only 事件日志；回放 = 重遍历 DAG + 注入记忆化输出。
5. 暂停/恢复只发生在节点边界；无人值守运行用预设权限策略，交互运行可经 permission 事件回路（capability 决定），workflow 级人工审慎点始终是 `human.gate`。
6. **per-CLI 差异**（resume/fork、结构化输出有无、沙箱形态、MCP 注入方式、事件粒度、权限回路有无）在 adapter 内归一化，以 capability 声明暴露给 Validator。
7. 全链路强类型：IR 有 schema，事件是 discriminated union，artifact 有类型。

## 5. 系统架构

```text
Natural language / Canvas / Template / JSON editor
        │ （四个 authoring surface，殊途同归）
        ▼
   Canonical IR (JSON) ←── ui_json sidecar（画布布局，不参与执行）
        ▼
   Validator（L1 schema → L2 图语义 → L3 引擎级 + capability 匹配）
        ▼
   Orchestrator（依赖调度 + 节点状态机 + 记忆化重遍历 + 活性看门狗）
        │
        ├─→ AgentAdapter Registry（ACP 统一 / per-CLI 原生，均可挂载）
        ├─→ Workflow MCP server（注入给每个 agent 会话：emit_artifact / get_context，task-scoped token，进程内 stdio）
        ├─→ Artifact Store（结构化产出，下游显式引用）
        ├─→ run_events（(run_id, seq) append-only：实时流、恢复、回放的唯一事实源）
        └─→ Human Gate / 权限应答 / 恢复入口（HTTP）
        ▼
   UI：Electron 薄壳窗口承载的 React 画布（+ inspector + 事件时间线 + artifact 面板 + agent 实时流）
        （壳只管窗口与生命周期；orchestrator 是独立 Node 进程，开发时可直接用浏览器连）
```

## 6. AgentAdapter 规范

一个实现可以是"覆盖所有 ACP agent 的 AcpAdapter"，也可以是"单个 CLI 的原生 adapter"。参考 per-CLI `Backend` 的单方法形状 + ACP 的能力协商：

```typescript
type AgentCapabilities = {
  resume: boolean;                // 续会话
  fork: boolean;
  structuredOutput: boolean;      // claude/codex 原生 true；opencode 与多数 ACP 适配器 false
  mcp: boolean;                   // 能否注入 workflow MCP server
  sandbox: boolean;              // 仅 codex 有 OS 级
  interactivePermission: boolean; // 运行中权限回路：ACP / claude SDK canUseTool / codex app-server 有；claude -p / codex exec / opencode run 无
};

type PermissionPolicy = {         // 声明式，adapter 映射到通道原生机制
  filesystem: "read" | "write";
  commands: "none" | "safe" | "all";
  network: boolean;
  mcp_servers: string[];          // 白名单（workflow MCP server 始终注入）
};

type Workspace = { path: string; mode: "shared_readonly" | "isolated_worktree" };

// 强类型事件联合——规避 {type: string, data: unknown} 弱类型信封
type AgentEvent =
  | { type: "session"; sessionId: string }            // 会话 id，一出现即持久化
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; callId: string; tool: string;
      status: "running" | "completed" | "failed"; input?: unknown; output?: unknown }
  | { type: "permission_request"; requestId: string; description: string;
      options: { id: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"; label: string }[] }
  | { type: "artifact"; artifact: unknown }            // 经 workflow MCP 工具上报，runtime 已校验
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: "raw"; payload: unknown };                 // 原始事件透传，调试与回放兜底

type AgentResult = {
  status: "completed" | "failed" | "cancelled" | "timeout";
  sessionId?: string;             // 持久化为恢复指针
  finalText?: string;             // 兜底输出；completed + 空文本合法（产出走工具通道）
  structuredOutput?: unknown;
  failureReason?: string;         // 分类学：agent_error|timeout|semantic_inactivity|resume_rejected|...
};

interface AgentAdapter {
  id: string;
  displayName: string;
  capabilities(): Promise<AgentCapabilities>;  // ACP：握手；原生：静态
  probe(): Promise<{ available: boolean; version?: string }>;  // CLI 是否可用
  execute(input: {
    taskId: string;
    prompt: string;
    workspace: Workspace;
    permissions: PermissionPolicy;
    mcpConfig: McpServerConfig[];        // 含 workflow MCP server（带 task-scoped token）
    outputSchema?: object;               // 仅 structuredOutput capability
    sessionId?: string;                  // 续跑
    timeoutSeconds?: number;             // 0 = 不设死线（活性交给看门狗）
  }): { events: AsyncIterable<AgentEvent>; result: Promise<AgentResult> };
  respondPermission?(taskId: string, requestId: string, optionId: string): Promise<void>;
  stop(taskId: string): Promise<void>;   // SIGTERM → 宽限 → SIGKILL 进程组
}
```

adapter 实现要点：

- **事件流归一化**：claude 的 system/assistant/result NDJSON、codex 的 thread/turn/item、opencode 的 NDJSON、ACP 的 session/update——收敛到 `AgentEvent`，无法归类走 `raw` 透传。
- **恢复指针捕获**：session id 在事件流里一出现就持久化（崩溃后才有恢复指针）；恢复被拒/返回新 id 报 `resume_rejected`，runtime 决定退新会话。
- **失败判定不能只看退出码/终态标志**（opencode RC=0 也可能失败）：以 error/result 事件 + artifact 校验为准。
- **活性**：runtime 层统一空闲看门狗（事件重置计时，工具在跑时放宽预算），adapter 不各自造轮子。

## 7. Artifact 产出通道（本项目自研差异化）

coding agent 是 agentic 循环，不是 schema 约束的生成器——"最后输出一段合法 JSON"不可靠。生产验证的答案：**给 agent 一个工具，让它主动上报**。

Runtime 为每个 `agent.run` 会话注入 **workflow MCP server**（进程内 stdio）：

- `emit_artifact(type, name, data)`——runtime 现场按 artifact schema 校验，非法立即报错给 agent 修正；成功即落库并发事件。
- `get_context(ref)`——按需拉取上游 artifact 全文（大 artifact 不必整个塞进 prompt）。

认证：工具调用携带 **task-scoped token**（随 MCP 配置注入），只授权本 node run 读写。

三级降级：

1. **首选** `emit_artifact` 工具；
2. **次选** `outputSchema` 结构化输出（claude/codex 原生）——适合 judge/reduce 类"最终裁决"节点；
3. **兜底** final text 存为 `report` 类 artifact（Phase 1 先用这个跑通）。

内置 artifact 类型：`plan`、`finding`、`decision`、`report`、`test_result`、`patch_summary`、`human_feedback`。`finding` 示例（evidence + dedupe_key 供 reduce 去重裁决）：

```json
{
  "type": "finding",
  "title": "Missing input validation",
  "severity": "high",
  "evidence": [{ "kind": "file", "path": "src/form.ts", "line": 42 }],
  "dedupe_key": "input-validation",
  "status": "open"
}
```

## 8. Canonical IR

JSON 是唯一可执行表示；扁平 `nodes[]` + `edges[]`，数据引用用命名空间模板变量，分支用边上 `when` 标签；字段 snake_case。（`schema` 字段的 `/v1` 是 IR 格式版本号，用于向后兼容。）

```json
{
  "schema": "agent.workflow/v1",
  "name": "Cross Agent Review",
  "inputs": {
    "target": { "type": "string", "description": "要 review 的 repo 路径 / PR / spec" }
  },
  "workspace": { "path": "{{inputs.target}}", "mode": "shared_readonly" },
  "actor": { "initiator": "local-user" },
  "policies": {
    "max_rounds": 3,
    "max_node_runs": 20,
    "timeout_seconds": 0,
    "default_permissions": { "filesystem": "read", "commands": "safe", "network": false, "mcp_servers": [] }
  },
  "nodes": [
    { "id": "planner", "type": "agent.run", "agent": "claude-code",
      "prompt": "Create a review plan for this repo. Emit it via emit_artifact(type=plan).",
      "output_artifacts": ["plan"] },
    { "id": "code_review", "type": "agent.run", "agent": "codex",
      "prompt": "Review implementation risk per the plan: {{nodes.planner.artifacts.plan}}. Emit findings via emit_artifact.",
      "output_artifacts": ["finding"] },
    { "id": "qa_review", "type": "agent.run", "agent": "opencode",
      "prompt": "Review QA/edge cases per the plan: {{nodes.planner.artifacts.plan}}. Emit findings via emit_artifact.",
      "output_artifacts": ["finding"] },
    { "id": "judge", "type": "agent.reduce", "agent": "claude-code",
      "prompt": "Deduplicate findings (by dedupe_key & evidence); decide if another round is needed.",
      "output_artifacts": ["decision", "report"] },
    { "id": "approve", "type": "human.gate",
      "suspend": { "title": "审批最终报告", "show": ["{{nodes.judge.artifacts.report}}"] },
      "decisions": [
        { "id": "approved", "label": "通过" },
        { "id": "rework", "label": "再来一轮",
          "resume_schema": { "type": "object",
            "properties": { "feedback": { "type": "string" } }, "required": ["feedback"] } }
      ],
      "timeout": { "seconds": 259200, "decision": "approved" } },
    { "id": "final_report", "type": "artifact.emit", "artifact_type": "report" }
  ],
  "edges": [
    { "from": "planner", "to": "code_review" },
    { "from": "planner", "to": "qa_review" },
    { "from": "code_review", "to": "judge" },
    { "from": "qa_review", "to": "judge" },
    { "from": "judge", "to": "approve" },
    { "from": "approve", "to": "final_report", "when": "approved" },
    { "from": "approve", "to": "judge", "when": "rework" }
  ]
}
```

要点：

- **并行非节点类型**：共享依赖即并行调度。示例中 `code_review`（codex）与 `qa_review`（opencode）跨厂商并行——**跨厂商同图协作是一等场景**。
- **数据传递 = 命名空间引用**（`{{nodes.<id>.artifacts.<name>}}`），并行分支天然隔离；大 artifact 由 agent 用 `get_context` 按需拉取。
- **workspace 是一等字段**：`shared_readonly`（review 类，全部节点同一 checkout + 只读权限）或 `isolated_worktree`（写类节点各自 git worktree，完成后产出 `patch_summary`）。
- **受控环**：环必须含 `human.gate` 且 `max_rounds` 必填；其余环禁止。
- **UI sidecar 单独存储**：`{ "node_positions": {...}, "collapsed": [] }`。

## 9. 节点类型（5 个 + 1 个可选）

| 节点 | 用途 | capability 要求 |
| --- | --- | --- |
| `agent.run` | 一个 agent 会话完成一轮任务，经工具通道产出 artifact | `mcp`（或降级兜底） |
| `agent.reduce` | 汇总上游 artifact：去重、裁决、归纳 | `structuredOutput` 或 `mcp` |
| `condition` | 声明式谓词路由（非表达式语言）：`{ "ref": "...", "equals": ... }` | — |
| `human.gate` | 暂停等人工：suspend 展示 → decisions 选出边 → resume_schema 收数据 → timeout 兜底 | — |
| `artifact.emit` | 固化最终结构化结果 | — |
| `tool.run`（可选，后续） | 白名单内置工具（test/lint），非任意代码 | — |

## 10. 状态机

```text
workflow_run:   created → running ⇄ waiting → completed | failed | cancelled

workflow_node_run:
  pending → ready → running → completed
                       ├→ waiting     （human gate 开启 / 交互权限待应答）
                       ├→ failed      （耗尽 max_attempts）
                       └→ cancelled
  pending → skipped                    （分支未选中）

agent_task:     running → completed | failed | cancelled | timeout
```

重试：失败建新 attempt（attempt+1），默认续用上次恢复指针（session id）；`failure_reason` 属"带毒"类（`iteration_limit`、`api_invalid_request`、`semantic_inactivity`、`resume_rejected`）时强制新会话。`max_attempts` 默认 2。

活性三层：硬超时（`timeout_seconds`，0 = 不设死线）；空闲看门狗（事件重置计时，工具在跑时放宽）；语义级不活动检测留作演进。

## 11. 数据模型（SQLite）

```sql
CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  ir_json TEXT NOT NULL, ui_json TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  ir_snapshot_json TEXT NOT NULL,     -- 启动时冻结，保回放保真
  status TEXT NOT NULL,
  inputs_json TEXT NOT NULL, outputs_json TEXT, error_json TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);

CREATE TABLE workflow_node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  node_id TEXT NOT NULL, node_type TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,   -- 受控环轮次
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 2,
  inputs_json TEXT, outputs_json TEXT, error_json TEXT,
  started_at INTEGER, finished_at INTEGER,
  UNIQUE (run_id, node_id, round)
);

CREATE TABLE agent_tasks (            -- 一次执行尝试；恢复指针挂这里
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id),
  agent_id TEXT NOT NULL, attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  session_id TEXT,                    -- 会话 id，事件流中一出现就持久化
  work_dir TEXT,
  result_json TEXT, error TEXT, failure_reason TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  node_run_id TEXT REFERENCES workflow_node_runs(id),
  type TEXT NOT NULL, name TEXT NOT NULL,
  dedupe_key TEXT, data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE run_events (
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  seq INTEGER NOT NULL,               -- 回放与断线 catch-up 的游标
  node_id TEXT, type TEXT NOT NULL, data_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
```

## 12. 事件日志与回放

事件类型（append-only，`(run_id, seq)`）：

```text
run_created/started/completed/failed/cancelled
node_ready/started/completed/failed/skipped/retried
task_started/finished, session_captured
agent_text_delta（采样/截断）, agent_tool_call, agent_usage
permission_requested/responded（交互权限通道时）
gate_opened/responded/timeout
artifact_emitted, artifact_rejected（schema 校验失败回给 agent 的记录）
watchdog_warning
```

三个能力共用一份日志（一个持久化原语撑起全部）：

1. **实时**：WS 推送；断线带 seq 重连补发。
2. **崩溃恢复**：重启后重遍历 DAG，completed 节点注入记忆化输出，从边界继续；中断的 running 节点按 session_id 续会话（无则新起）。
3. **回放**：按 seq 折叠事件重建任意时刻全图状态；时间线拖动 = 选 seq 截断折叠。

## 13. 上下文隔离与执行环境

| 层 | 说明 |
| --- | --- |
| `workflow.input` | 用户输入，全局可读 |
| `node.private` | agent 会话内部上下文，不外泄 |
| `artifact.public` | 节点经工具通道显式产出的结果 |
| `reducer.context` | reduce 节点可读的全部上游 artifact |

规则：下游只读显式入边来源的 artifacts；并行分支互相隔离；只有 reducer 汇多路；gate 提交成为 `human_feedback` artifact。

执行环境按 workspace mode 分两族：`shared_readonly`（全部节点共享一个 checkout，靠 `permissions.filesystem: "read"` 保护）；`isolated_worktree`（每写节点一个 git worktree，完成后产出 `patch_summary`，后续版本实现）。

## 14. Validator（三层）

错误输出结构化（`{ node_id?, edge?, code, message }[]`），同时服务画布高亮与 LLM 修正循环。

- **L1 Schema**：zod 校验 IR；未知字段拒绝。
- **L2 图语义**：id 唯一；边端点存在；无不可达节点；环必须含 human.gate 且 max_rounds 已设；分支出边 `when` 覆盖全部 decision/谓词结果（或有 default）；模板引用可解析到上游 `output_artifacts`；`agent` 存在且节点要求 ⊆ capabilities（如 `agent.reduce` 需 `structuredOutput || mcp`；`filesystem: "write"` 节点在 `shared_readonly` workspace 非法）。
- **L3 引擎级**：`probe()` 确认 CLI 可用；空值试展开模板；`resume_schema` 是合法 JSON Schema；写文件/跑全量命令的节点路径上必须有 human.gate。

LLM 生成：draft → Validator → 结构化错误回喂（≤3 轮）→ 人确认。后续演进：受约束构图操作（n8n AI Builder 路线）。

## 15. 调度算法

```text
start(run): 冻结 ir_snapshot；全节点 pending；append run_started

step(run):                                # 任何事件后重入
  依赖满足（来源 completed 且 when 匹配）的 pending 节点 → ready
  来源被 skip / 分支未选中 → skipped
  并行启动 ready 节点（并发上限可配）:
    agent.run/reduce → 建 agent_task → adapter.execute（prompt、workspace、
                        permissions 映射、workflow MCP server、上游 artifact 引用）
                     → 消费事件流：session id 一出现即持久化；text 批量落事件（~500ms 批）；
                        artifact 经校验落库；permission_request → node waiting + UI 提示；
                        空闲看门狗计时
    human.gate → waiting; append gate_opened; run → waiting
    condition  → 同步求值，completed
    artifact.emit → 固化，completed
  节点终态 → append 事件 → 重入 step
  全部终态 → run completed

resume(run): completed 节点注入输出不重跑；
             中断的 running 节点按 session_id 续会话或新起；
             step(run)
on gate 应答: 校验 resume_schema → human_feedback artifact → gate completed(decision) → step(run)
on 失败: attempt < max_attempts → 新 attempt（failure_reason 带毒则弃会话）；否则 node failed → run failed
```

## 16. 技术选型与仓库结构

```text
形态     本机 Electron 桌面 app（薄壳：窗口 + 生命周期 + 打包；不承载业务逻辑）
运行时   Node.js 22 + TypeScript (strict)
后端     Hono（HTTP + WebSocket），独立单进程（不进 Electron 主进程，保持可独立测试与浏览器调试）
存储     SQLite（better-sqlite3），第 11 节 6 张表（orchestrator 进程内嵌入式，本地 .db 文件）
校验     zod（L1）+ 自写图语义校验器（L2/L3）
前端     Vite + React + @xyflow/react（React Flow），由 Electron 窗口加载
Agent    AgentAdapter registry；Phase 1 起步 Codex 原生通道（app-server），Phase 3 覆盖 Claude Code / Codex / OpenCode
MCP      @modelcontextprotocol/sdk：workflow MCP server（进程内 stdio）
测试     vitest；Validator、状态机、各 adapter 的事件归一化必须有表驱动单测
```

```text
/shared    IR 类型、zod schema、AgentEvent 联合、artifact 类型
/server    orchestrator、validator、adapters/、mcp-server、store、API
/web       画布、inspector、时间线、artifact 面板、gate 表单
/desktop   Electron 薄壳（窗口、server 进程生命周期、打包）
/examples  三条 demo flow 的 IR JSON
```

UI（第一屏即 runtime）：顶部 selector/Run/状态；左 workflow 列表；中画布（节点颜色=状态）；右 inspector（输入/输出/错误）；底部事件时间线（可拖动回放）/ agent 实时流 / artifacts。可信优先于美观。

## 17. 从单机 demo 到更重形态的差距清单

| demo 简化 | 更重形态 |
| --- | --- |
| 单进程 orchestrator | 事件日志已是唯一事实源，多实例只差租约选主 |
| shared_readonly 共享 checkout | worktree 池（租约计数、脏树保护、路径锁）——写场景需要 |
| 本机进程与 orchestrator 同生死 | 本地无头队列化（`queued → dispatched → running`、prepare-lease、原子孤儿回收）——坚持无人值守本机队列时需要 |
| 少量 failure_reason | 完整失败分类学，驱动差异化重试 |
| SQLite | Postgres；事件表分区与归档 |

## 18. Demo Flows

1. **Cross-Agent Review**（主打，§8 示例）：Claude Code 规划、**Codex 与 OpenCode 并行 review**、Claude Code 裁决 + human gate（含 rework 环）→ 最终报告。**跨厂商同图协作**是最强演示点。
2. **Spec To Tasks**：产品想法 → brief → 模块拆解 → 验收标准 → 合并 → task breakdown。证明不是 review-only。
3. **Bug Triage**：bug 报告 → 复现 / 代码定位 / 风险评估并行 → 裁决 → 诊断与 next actions。证明模型可泛化。

## 19. 实施路线（每 Phase 一个可展示 checkpoint）

**Phase 1 — 单通道跑通**：实现第一个 adapter（Codex app-server 原生通道）；写死 Cross-Agent Review IR（无环、单 agent 版）；L1+L2 最小校验；状态机 + run_events 落库；final text 兜底成 artifact；Electron 薄壳内的只读画布显示节点状态与实时流。

**Phase 2 — Visual Authoring**：React Flow 增删改；ui_json sidecar；Validator 错误画布高亮；画布只产出 IR。

**Phase 3 — 多 agent 并行 + 工具通道**：补齐 Claude Code / Codex / OpenCode 三家 adapter（事件归一化单测）；workflow MCP server（emit_artifact/get_context + task-scoped token）；`agent.reduce`；失败重试（attempt/failure_reason/带毒判定）；UI artifact 溯源。

**Phase 4 — Human Gate + 恢复**：gate 四要素；受控环（max_rounds）；恢复指针持久化 + 杀进程重启续跑；时间线按 seq 回放（真 e2e：spawn → kill -9 → restart → assert）。

**Phase 5 — Natural Language To IR**：LLM 生成 draft → Validator 错误回喂（≤3 轮）→ 确认保存运行。

## 20. 成功标准

1. 一份 IR 被画布、JSON 编辑器、自然语言三个入口共同产出与消费；
2. **至少三家 agent 在同一 run 中并行执行**（跨厂商：Claude Code / Codex / OpenCode）；
3. artifact 经 `emit_artifact` 工具通道产出并可溯源到节点；schema 不合法时 agent 收到报错并修正；
4. 每节点有可见状态/输入/输出/错误；human gate 能暂停、超时、恢复；受控环被 max_rounds 拦住；
5. 杀进程重启后 run 从断点继续：completed 不重跑，中断节点按 session 续；
6. 时间线可拖动回放任意历史时刻；
7. 喂一份 LLM 生成的坏 IR，拿到结构化错误并完成修正循环；
8. UI 不决定执行语义；LLM 生成结果不直接执行。

## 21. 不做清单

不做完整 Dify clone；不做团队/组织/计费；不做任意代码节点与表达式语言；不做 marketplace；不做嵌套 workflow；不做无 human gate 的环；不做跨设备同步；不做分布式队列；**不做云 task 通道与云执行基础设施**——执行面是本地 CLI 进程；产出经注入的 MCP 工具上报而非解析文本。

## 22. 叙事

> 多 Agent 聊天不是编排。我调研了 Dify、LangGraph、Mastra、Temporal，源码级考察了生产系统怎么驱动本地 coding CLI。我的判断：workflow 应该是一份 Canonical IR——显式 DAG 本身就是确定性控制流，一份 append-only 事件日志就同时给出实时流、崩溃恢复和回放；编排的执行单元是完整的 coding agent 会话，产出经注入的 MCP 工具上报而非解析文本；人工审慎点放在 workflow 层的 human gate。市面上的多 agent 工具停在"并行跑 + diff 审查"，Claude Code 的 Dynamic Workflows 停在单厂商 subagent 的一次性脚本编排——都没有把它做成跨厂商、可校验、可回放的 workflow 数据。这就是这个项目要证明的技术形态。

展示顺序：讲问题 → 看 IR 与图 → 点 run（三家 agent 并行、实时流同屏）→ artifact 溯源（工具通道上报）→ gate 暂停/恢复 → 杀进程重启续跑 → 拖时间线回放 → 讲两种集成策略的取舍与差距清单。
