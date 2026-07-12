# AGENTS.md — Agent Workflow Runtime

一句话：可视化、可生成、可验证、可回放的 Agent Workflow Runtime——编排真实本地 coding agent（Claude Code / Codex / OpenCode）的控制面。蓝图见 `docs/PRD.md`，构建方法论见 `docs/ai-native-build.md`，不可违反原则见 `docs/constitution.md`。

## 命令

（脚手架落地后由 initializer 会话更新此节；预定为 pnpm 工作区：
`pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e`）

## Spec 层（OpenSpec，含本仓库的用法覆盖）

- `openspec/specs/<capability>/spec.md` 是 **living spec**：只描述"已建成的现状"。改行为的 PR 必须同步对应 spec。
- 大变更先走 `openspec/changes/<change>/` 提案（proposal + design + spec delta），经 proposal PR 人审合并。
- **本仓库覆盖 OpenSpec 默认工作流**（此声明优先于 OpenSpec 生成的技能指引）：
  - 人工本地会话可用 `/opsx:explore`、`/opsx:propose`。
  - **不使用 `/opsx:apply` 与 `/opsx:archive`**：实现走 GitHub Issue → 本地 CLI builder（`node scripts/dispatch.mjs <issue#>`）→ PR；归档由 `spec-archive` workflow 在 change 关联 issue 全部关闭后开归档任务 issue（人本地跑 `/opsx:archive` 或 dispatch）。
  - **tasks.md 是初始拆解快照**：播种成 GitHub Issues 后不再维护，不要去勾选或更新它。活状态只看 Issues。

## 测试所有权（测试作者与实现者分离）

- **`acceptance/**` 是验收测试区，由 test-writer agent 专职产出**（从 issue 判据 + spec 的
  GIVEN/WHEN/THEN scenarios 派生，不看实现）。builder 禁止创建、修改、删除其中任何文件（test-guard 强制）。
- builder 可以写单元/集成测试辅助开发，但**验收只认 acceptance/ 套件转绿**，
  自己写的测试不作为完成依据。
- vitest 约定：默认 `pnpm test` 排除 `acceptance/`；`pnpm acceptance` 单独运行验收套件
  （P1 脚手架负责接线）。

## 角色与 agent 选择（本地通道）

- 执行者是本机 CLI（Claude Code / Codex / OpenCode），经 `gh` 留痕；**无云 agent、无 CI 内跑模型**（决策 D9）。
- 每个 issue 用 label 选人（可不同、非固定）：`agent:build:<claude|codex|opencode>`（谁实现）+ `agent:review:<...>`（谁做顾问评审）。缺省 builder = codex；未指定 reviewer 时自动选择异于 builder 的 agent。
- 触发：常驻 `node scripts/watch.mjs` 是全链入口（issue 打 `ready` → 自动提案 / 播种 / 派发 / 顾问评审，首次 `VERDICT: CHANGES` 自动回喂原 builder 复修一次并复审一次；人只审提案与终审 merge，见决策 D12）。底层脚本可单独手动跑（调试 / 接管）：`dispatch.mjs <issue#>`（builder → 本地确定性检查回喂环 ≤3 次 → 开 PR；仍不绿自动记卡点 + needs-human，D10）、`review.mjs <PR#>`（reviewer 在 PR head 的一次性 worktree 里读码 + 实机验证后评审 → 发顾问评论，并维护 `advisor-review` 存在性门禁与评审硬超时，D15）。自动化必须设置 `AGENT_GH_TOKEN`，缺失时 fail-closed，不回落人的 `gh` 身份。适配器表见 `scripts/agents.mjs`。

## 工作纪律

1. **一次只做一个 issue**，产出只能是一个 PR（描述里写清做了什么、为什么、遗留什么，`Closes #<issue>`）。不顺手重构，不顺手修范围外的问题。**开工前认领**（assignee 或触发 label 即认领），一个 issue 同时只允许一个 builder；`node scripts/dispatch.mjs <issue#>` 自动为每 issue 建 `issue/<n>` 分支的 worktree（Claude Code 也可 `claude -w`）。
2. **研究先行**（constitution 第 9 条）：结论性断言先取证——检索最新资料、读代码读文档，结论附来源；取证不可得时标注为假设。
3. **先搜索再动手**：搜已有 issue（`gh issue list --search`）与代码，不假设"还没实现"。
4. **范围外发现**（bug、坏依赖、spec 矛盾）：搜索去重后开 `origin:ai` issue 并链接当前工作，然后回到本职。
5. **提问**：在当前 issue 评论并打 `needs-human` label，或开 `type:question` issue。不要猜测需求。
6. **卡住协议**：同一错误两次未解 → 在 issue 评论记录现状与卡点，打 `needs-human`，PR 留 draft，结束本次 run。
7. **受保护文件**：agent 仅当当前 issue 明确将 `docs/**`、`.github/**` 列入范围时可起草；只能在 issue 分支提交并走 PR，必须经 CODEOWNERS 人审。agent 永远不得直接 push 受保护分支或 merge。openspec/** 可在 PR 中改（同步 spec 是义务），也必经 CODEOWNERS 人审。
8. **禁止**：修改/删除既有测试（新增可以）；关闭 issue（只能由合并的 PR 自动关闭）；**运行 `scripts/watch.mjs`（watch 是全机单实例的常驻编排进程，只由人启动——agent 永远不得自行拉起）**。

## Definition of Done

required checks 全绿（**ci + spec-validate + test-guard + advisor-review**，均确定性）+ 对应 spec 已同步 + PR 描述完整。跨 agent 的 review / verify 是**顾问意见、非门禁**——`advisor-review` 卡的只是「顾问评论已存在」这一确定性事实（评审超时 / 失败自动放行 + `needs-human`，D15），评审结论不阻塞合并。merge 由**人**终审执行，不由你执行。注意：验收判据先于实现存在、`acceptance/` 由 test-writer 拥有——实现必须真实可运行到验收测试转绿，糊弄测试没有意义（宪法第 2、10 条）。
