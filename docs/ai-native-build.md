# AI-Native 实施手册：本地 CLI 通道把项目造出来

配套 `PRD.md`（规定"造什么"）。本手册规定"怎么造"：**人掌控 spec、验收判据、门禁与最终 merge**；实现与获得 issue 明确授权的文档起草由本机 coding CLI（Claude Code / Codex / OpenCode）完成、经 `gh` 在 GitHub 留痕，每个 issue 可动态指定谁 build、谁 review。全部过程状态（需求、提问、发现、演变）落在公开 GitHub 对象上，任何人可随时重建项目史。

## 1. 五条公理（第一性原理）

1. **人的杠杆点在 spec、验收判据、审查门禁**，不在代码——控制面归人。
2. **奖励函数是确定性的、且执行者不可篡改**：required checks 只由确定性检查构成（`ci`：typecheck/lint/test 含验收测试；`spec-validate`；`test-guard`）；不可篡改靠 branch protection + CODEOWNERS + "只有人能 merge"。**LLM review/verify 是顾问，不进关键路径**。
3. **审查是多样性第二意见，不是保证**：跨 CLI（尽量异厂商）的 review 降低单一盲点，但模型错误相关（「Great Models Think Alike」），真正的防糊弄靠**确定性验收测试 + 人终审**。
4. **工作单元要小、每单元新鲜上下文、失败重试便宜**：一次 dispatch = 一个隔离 worktree 里的一次全新 headless CLI 会话。最强模型的可靠时间跨度以小时计（METR），失败是常态，单元越小越稳。机器能判定的失败不等人：dispatch 内置确定性停机的重试环（D10）。
5. **全部状态公开、append-only**：issue / PR / check / git log，可审计、可随时接入。

## 2. 系统形态

```text
人审 openspec/（living specs + 在途变更）+ constitution.md + AGENTS.md（控制面，CODEOWNERS 保护）
        ↓
工作单元 = GitHub Issue（验收判据在正文；label 协议：ready / agent:build:<x> / agent:review:<x>）
        ↓
本地 watch（常驻单进程，全链入口，D12）：node scripts/watch.mjs
  ready（无 change/agent:build）→ propose.mjs 起草提案 PR ——【人审判据 = 定奖励函数】
  提案 merge → 自动播种实现 issues（自带 ready；同 change 串行派发）
  ready（有 change 或 agent:build）→ dispatch.mjs：
    建 issue/<n> worktree → 跑指定本机 CLI（Claude Code / Codex / OpenCode）实现
    → 本地确定性检查（typecheck/lint/test，required checks 的本地镜像）
        红 → 失败截尾回喂续跑（≤3 次，确定性停机）；仍红 → issue 记卡点 + needs-human，不开 PR
        绿 → 开 PR（Closes #n + Built-by + Local-checks 留痕）→ 自动 review.mjs 顾问评审（非门禁）
          PASS → 等人终审
          首次 CHANGES → 回喂原 builder 复修一次 → 复审一次
            复审 PASS → 等人终审
            复修/复审失败或复审仍 CHANGES → 停止自动循环，交人
        ↓
required checks（确定性奖励函数）= ci + spec-validate + test-guard
        ↓
人终审 merge → 自动 Closes #issue → 看板更新
```

**换 builder/reviewer = 换 label**：prompt 是 agent 中立的（issue 正文 + AGENTS.md）、状态全在 GitHub、门禁全是确定性检查（对 builder 是谁无感）。适配器表 `scripts/agents.mjs` 加一条三元组即接入一家新 CLI——这套管线正是产品要造的东西的退化形态。

**循环层**：dispatch 重试环只循环**确定性信号**（本地检查红/绿），停机条件 = 全绿或次数用尽（默认最多 3 次）。顾问层是另一个有界闭环：仅首次 `CHANGES` 触发一轮复修/复审，失败或二次 `CHANGES` 交人。顾问仍非 required gate，不让 LLM 自评「完成」（宪法第 10 条），不做无界无人值守循环。

## 3. 仓库脚手架

```text
project-root/
├── openspec/                 # OpenSpec：config.yaml + specs/<capability>/ + changes/<change>/
├── docs/                     # PRD / ai-native-build（本文）/ constitution / operations / decisions
├── AGENTS.md · CLAUDE.md · README.md   # 根目录发现约定（CODEOWNERS 保护 AGENTS/CLAUDE）
├── .claude/settings.json · .codex/     # 本地配置；不 deny 已获 issue 授权的受保护文件起草
├── scripts/
│   ├── agents.mjs            # 适配器表（本地 CLI × build/review）——产品 AgentAdapter registry 退化版
│   ├── watch.mjs             # 常驻全链入口：ready → 提案/播种/派发/自动评审（D12）
│   ├── propose.mjs           # 需求 issue → 起草 openspec change → 提案 PR
│   ├── dispatch.mjs          # issue → 指定 builder → worktree → 重试环 → PR
│   ├── review.mjs            # PR → 指定 reviewer → 顾问评论
│   └── seed-issues.mjs · worktree.sh · bootstrap-github.sh
└── .github/
    ├── CODEOWNERS            # openspec/** docs/** .github/** AGENTS.md CLAUDE.md → 人
    ├── ISSUE_TEMPLATE/ …
    └── workflows/            # 全确定性、无 agent、无密钥：
        ├── ci.yml            # typecheck + lint + test（+ 验收套件）(required)
        ├── spec-validate.yml # openspec validate --strict (required)
        ├── test-guard.yml    # 动既有/验收测试须人工豁免 (required)
        ├── audit.yml         # 定时：重开违规关闭的 issue + needs-human 队列
        └── spec-archive.yml  # change 关联 issue 全关 → 开归档任务 issue
# src/ 见 PRD §16：/shared /server /web /examples
```

### Spec 层：OpenSpec

[OpenSpec](https://openspec.dev)（Fission-AI，MIT）：living specs（只描述已建成现状）+ changes/ delta（ADDED/MODIFIED/REMOVED）+ `openspec validate --strict`（进 required checks）+ archive。用法覆盖两处：tasks.md 仅作播种快照（issue 是唯一活状态）；archive 由 workflow 在 change 关联 issue 全关后开归档任务 issue（人本地 `/opsx:archive` 或 dispatch 执行，PR 走 CODEOWNERS 人审）。living specs Day-0 为空（greenfield 未建成任何东西），PRD 内容经各 Phase 的 change 提案分批进入。

## 4. 工作单元：Issue 的纪律

- **粒度**：一个 issue = 一次本地 run 能独立完成、值回成本的变更（约半天人类工作量）。太碎合并，太大拆提案。
- **验收判据先于实现**：写在 issue 正文 checklist，每条可由 CI / 测试 / 可观察行为证实——奖励函数的人读版。
- **label 体系**：`type:*`、`origin:*`、`phase:*`、`ready`、`wip`、`needs-human`、`approved-test-change`、`change:<name>`、`agent:build:<x>`、`agent:review:<x>`。Milestone = PRD Phase；Projects v2 看板是进度仪表盘。
- **issue 只能被 merged PR 关闭**；audit workflow 定时重开违规关闭的 issue。
- **AI 发现范围外问题** → 搜索去重 → 开 `origin:ai` issue 链接当前 → 回本职，不顺手修。
- **卡住协议**：同一错误两次未解 → issue 记录卡点、打 `needs-human`、停手，不无限重试烧钱。

## 5. 常驻 / 按需装置

- **watch**（本地常驻单进程，全链入口，D12）：轮询 ready issue → 自动提案 / 播种 / 派发（D10 重试环）/ PR 顾问评审；首次 `CHANGES` 自动回喂原 builder 复修一次并复审一次，失败或二次 `CHANGES` 交人；人只审提案与终审 merge。未指定时 builder 缺省 codex，reviewer 自动选择异于 builder 的 agent。启动前必须有 `AGENT_GH_TOKEN`，缺失即 fail-closed。**只由人启动（agent 禁止拉起）**；全机单实例（PID 锁）；认领 = `ready → wip`，崩溃遗留的 wip 下次启动自动还原为 ready。
- **audit**（workflow，确定性，唯一云端常驻自动化）：issue 关闭合法性、`needs-human` 队列播报。
- **triage**（人）：新需求 = 开 issue + 打 ready（watch 自动起草提案）；也可本地会话手动 `/opsx:propose` 先探索。人审提案 = 审定奖励函数。
- **gap-analysis / 学习环**（本地按需）：定期让本地会话对照 living specs 与代码找漂移 → 开 issue 归队；有摩擦的 PR 合并后提炼教训 → AGENTS.md（人审）。轻量、按需、零常驻成本。

## 6. 强制层：确定性门禁 + 人终审

- **branch protection**（main + phase 分支）：required checks = `ci` + `spec-validate` + `test-guard`（全确定性）；禁 force push；CLI 无 merge 权。**merge 是唯一收敛点，且只有人能按**。
- **CODEOWNERS**：`openspec/**`、`docs/**`（含本文与 PRD）、`.github/**`、`AGENTS.md`、`CLAUDE.md` 变更必须人审。
- **test-guard**：动既有测试 / 实现 PR 夹带新增验收测试 → 红，除非人打 `approved-test-change`。
- **验收测试是奖励函数的核心**：由 test-writer（可指定任一 CLI、只读判据不看实现）从判据 + spec 的 GIVEN/WHEN/THEN scenarios 派生，test-guard 锁住 builder 不能改，CI 里转绿才算过——确定性、厂商中立、不可篡改。
- **顾问评审（review.mjs）**：异 CLI 第二意见，发 PR 评论；首次 `CHANGES` 可触发最多一轮原 builder 复修/复审，**仍非门禁、不阻塞合并**。reviewer 在 PR head 的临时 detached worktree 里跑（写不到主工作树，评审毕即删），读码之外须实机执行验证命令（install / test / smoke）核实判断，GUI 改动经 Playwright MCP（CDP 接管 Electron）实际操作验证——与 CI 确定性测试分工：CI 管已知不变量的回归，reviewer 管本次 diff 的探索路径；gh 上报只由脚本做；diff / 判据落文件传路径；对抗式双视角竞争评审。
- **受保护文件起草**：本地 hooks 不笼统 deny `docs/**` 与 `.github/**`；agent 仅在 issue 明确列入范围时可在 issue 分支起草。硬边界是 branch protection + CODEOWNERS + required checks + 人终审；agent 永远不得直接 push 受保护分支或 merge。

## 7. 与 PRD Phase 对齐

里程碑 = PRD Phase 1–5。每 Phase 一个 milestone + phase 分支（同样受保护、同样确定性 required checks），Phase 收尾 PR 人审——人只深审这几次 + 审定各批 issue 判据。

| 里程碑 | 要点 |
|---|---|
| P1 单通道跑通 | IR 解析、L1/L2 校验、状态机、事件落库、首个本地 adapter、UI 只读；adapter 事件归一化用录制真实输出做表驱动测试 |
| P2 多 agent 并行 + 工具通道 | 补齐 Claude/Codex/OpenCode 三家本地 adapter、workflow MCP server（stdio）、`agent.reduce`、失败重试 |
| P3 gate + 恢复 | gate 四要素、受控环、杀进程重启续跑、seq 回放（真 e2e：spawn → kill -9 → restart → assert）|
| P4 画布 | React Flow、sidecar、错误高亮 |
| P5 NL→IR | 生成→校验→回喂循环 |

**测试金字塔**：unit（Validator/状态机/调度/事件折叠，纯确定性）+ 集成（`FakeAdapter` 脚本化事件序列 + 故障注入）进 CI；adapter 归一化用**录制的真实 CLI 输出** fixture 做表驱动；真 CLI 冒烟本地手动跑（不进 CI，无密钥）。

## 8. 失败模式对照表

| 失败模式 | 对策 |
|---|---|
| 过早宣布胜利 | 验收判据先于实现 + 确定性 required checks；merge 前无"完成" |
| 占位符/stub 糊弄 | constitution 大写禁止 + 判据派生的**确定性**验收测试 + 顾问评审 + 人终审 |
| 改/删测试骗绿 | test-guard required check（人工豁免才放行） |
| 逐步漂移出 spec | living spec 铁律 + spec-validate + 按需 gap-analysis |
| 重复造已有轮子 | "先搜索再假设未实现"写进 AGENTS.md 与 issue 模板 |
| 卡死/成本螺旋 | 卡住协议（needs-human）+ issue 粒度 + 重试环封顶 + 成本走本地订阅、你可随时打断 |
| 悄悄砍范围 | 判据先行（砍范围过不了 check）+ 人审里程碑 |
| 供应商依赖 | agent 中立的 issue + AGENTS.md；换 CLI = 换 label；无云、无按量 API |
| 篡改门禁本身 | CODEOWNERS 覆盖 .github/** openspec/** docs/** AGENTS.md；audit 巡检 |
| 对可见验收测试过拟合（背题） | test-guard 挡「改题」不挡「背题」；公开 repo 无法 held-out——已接受的残余风险（D11），兜底 = 顾问评审看实现是否泛化 + 人终审 |

## 9. Day-0 Runbook

1. `gh auth login` → `./scripts/bootstrap-github.sh`（建公开 repo + labels + milestones + branch protection，零 Actions Secret）。
2. 为 bot collaborator 创建 classic PAT（`repo` scope）并 `export AGENT_GH_TOKEN=<PAT>`；自动化缺失它会 fail-closed。
3. 本机装好并登录 `claude` / `codex` / `opencode`。
4. 实测门禁：试 merge 未过 check 的 PR、试让 agent 改 `openspec/`，都应被拒。
5. 起 `node scripts/watch.mjs` → 开首个需求 issue 并打 `ready` → watch 自动起草提案 PR。
6. **人逐条审定提案里的验收判据**（这是奖励函数，值得花一小时）→ merge → watch 自动播种、派发、顾问评审与最多一轮复修/复审 → 人 merge 实现 PR。完整走一遍全链。
7. 稳定后加大并行（每 issue 一个 worktree，经验 2–4 并发）。全程任何人打开 repo 可从 issues + PR + checks + git log 重建演变史。

## 10. 现实预期

- **成本**：走本地 CLI 订阅/凭证，无按量 API Secret；粒度 = 每 issue 一次本地 run，靠 issue 纪律控制；你可随时打断。
- **"人不写代码"的真相**：人不敲函数体，但要写**接口契约 + 验收判据 + 测试规格**——greenfield 架构期接口就是设计本身，这部分智力工作仍在人这边。人力集中到 specs 与判据，正因为**它才是约束瓶颈**：垃圾判据进垃圾产品出。
- **瓶颈是评审不是产出**：本地并行别贪多；人的可审阅带宽 + 确定性测试才是真关卡——所以把 gate 放在人、把并行放在 issue 粒度。
- **失败是常态而非异常**：小 issue + 便宜重试（重试环 + 重跑 dispatch）为此设计；单元越小越稳。

## 来源

- Anthropic：claude.com/blog/getting-started-with-loops · code.claude.com/docs/en/workflows（Dynamic Workflows：journal + resume 记忆化）· code.claude.com/docs/en/github-actions
- OpenAI：developers.openai.com/codex（cli / sandbox / mcp；cloud 出网限制；云 task 无公开 steer/cancel API——本地 app-server 有 turn/steer 与 turn/interrupt）
- GitHub：github.blog Agent HQ（跨厂商控制面）· Copilot coding agent MCP 文档
- 同类关停：github.com/terragon-labs/terragon-oss · Vibe Kanban 母公司关停
- 标准 / spec：agents.md（Linux Foundation AAIF 托管）· openspec.dev · github.com/Fission-AI/OpenSpec（MIT）
- 可靠性与对抗：metr.org/blog/2026-1-29-time-horizon-1-1 ·「Great Models Think Alike」arXiv 2502.04313 · SpecBench arXiv 2605.21384 · Verification Horizon arXiv 2606.26300
- 循环层：addyosmani.com/blog/loop-engineering · lucumr.pocoo.org/2026/6/23/the-coming-loop · ghuntley.com/loop
- 评审经济学与瓶颈：blog.fsck.com/2026/06/15/Superpowers-6 · blog.fsck.com/2026/05/01/adversarial-review · linearb.io 2026 benchmarks · augmentcode.com（CIV / oracle risk）
