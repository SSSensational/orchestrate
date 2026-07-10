# 操作手册（Day-N）

人的日常操作参考。方法论与原理见 `ai-native-build.md`，本文只讲"怎么用"。

**执行面 = 纯本地 CLI（Claude Code / Codex / OpenCode）**，通过 `gh` 在 GitHub 上留痕（issue / PR / check）。
无云 agent、无 `ANTHROPIC_API_KEY`、无 workflow 里跑模型（决策 D9）。

## 激活清单（一次性，按序）

1. `gh auth login`
2. `./scripts/bootstrap-github.sh` —— 建公开 repo + push + labels + milestones + branch protection（required checks = ci / spec-validate / test-guard，**无需任何 Secret**）
3. 本机装好要用的 CLI 并各自登录：`claude` / `codex` / `opencode`（用你的订阅/凭证，成本走本地）
4. 实测门禁：试 merge 一个未过 check 的 PR、试让 agent 改 `openspec/`（应被 CODEOWNERS 拦），确认门禁生效
5. bootstrap 后 main 受 branch protection（禁 force push）：起始的单 commit 就此定格为项目起点，此后历史 append-only（公理 5），不再 amend
6. 起常驻进程：`node scripts/watch.mjs` —— 全链入口（D12），此后日常你只碰 GitHub

## 日常只有三个动作（前提：本机挂着 `node scripts/watch.mjs`）

watch 是全链入口（D12）——提案、播种、派发（D10 重试环）、顾问评审全自动。你只碰 GitHub。
**watch 只由人启动**（agent 禁止拉起，AGENTS.md 纪律 7）；全机同时只允许一个实例（PID 锁，重复启动直接退出）；认领 = `ready → wip`，崩溃遗留的 `wip` 在下次启动自动还原为 `ready` 归队。

| 动作 | 说明 |
|---|---|
| **提需求** | 开 issue（模板），判据/需求成型后打 **`ready`** label。默认走提案路径（watch 自动起草 openspec change 提案 PR）；小事想跳过提案：打 `ready` + `agent:build:<x>` 两个 label → 直接实现 |
| **审提案** | watch 起草的提案 PR：**逐条审验收判据——这是奖励函数，全流程最值得花时间的一步** → merge。merge 后 watch 自动播种实现 issues（自带 ready + 判据）并逐个派发 → 开 PR → 自动顾问评审；同 change 的 issue 串行防语义冲突 |
| **放行** | 实现 PR：三个 required check 全绿（ci / spec-validate / test-guard）+ 看顾问评审（已自动发）→ 你 merge（issue 自动关闭）。**人是终审** |

不挂 watch 时底层脚本可手动跑（调试 / 接管）：`propose.mjs <issue#>`、`seed-issues.mjs <change> [milestone]`、`dispatch.mjs <issue#>`、`review.mjs <PR#>`。

日常巡检：看板 + `needs-human` label 队列（audit workflow 每日在 Actions job summary 播报）。

## 指定 builder / reviewer（任意 CLI，非固定）

角色与 agent 的对应**由 label 决定，每个 issue 可不同**：

- `agent:build:claude` / `agent:build:codex` / `agent:build:opencode` —— 本 issue 由谁实现
- `agent:review:claude` / `agent:review:codex` / `agent:review:opencode` —— 本 issue 由谁做顾问评审

```bash
# 例：Codex 造、Claude 审
gh issue edit 12 --add-label agent:build:codex --add-label agent:review:claude
node scripts/dispatch.mjs 12          # 用 Codex 在 worktree 实现 → 开 PR
node scripts/review.mjs <PR#>         # 用 Claude 只读评审 → 发顾问评论

# 临时覆盖 label：第二参数指定 agent
node scripts/dispatch.mjs 12 opencode
node scripts/review.mjs <PR#> codex
```

- **不打 label 时的缺省**：builder = `--builder`、reviewer = `--reviewer`（当前均缺省 codex）；手动跑 `review.mjs` 不带参时自动取异于 builder 的一家。builder 与 reviewer 同厂商时告警提示（模型盲点相关，见 "Great Models Think Alike"——异厂商第二意见更有效，是否接受由你）。打了 label 则以 label 为准。
- 顾问评审**不是必过门禁**：抓不抓得到问题都不阻塞合并；真正的关卡是确定性检查 + 你的终审。
- reviewer 在 PR head 的临时 detached worktree（只读副本）里运行，diff 与判据落文件传路径——省 token，且对无只读沙箱的 CLI（opencode）是硬隔离。
- 适配器表在 `scripts/agents.mjs`（产品 AgentAdapter registry 的退化形态）；新增一家本地 CLI = 加一条三元组。

## label 语义速查

- `ready` —— 人的开工信号：无 change/agent:build 走提案，有则直接实现
- `wip` —— watch 已认领、执行中；完成自动清除，失败转 needs-human，崩溃遗留下次启动还原为 ready
- `agent:build:<x>` —— 指定本 issue 的 builder（本地 CLI）
- `agent:review:<x>` —— 指定本 issue 的 reviewer（顾问，非门禁）
- `needs-human` —— agent 在等你答复/裁决；处理完后重新点火 = `--remove-label needs-human --add-label ready`
- `approved-test-change` —— 人工豁免：允许该 PR 修改既有测试（必须由人打，test-guard 会核验 actor）
- `change:<name>` —— 该 issue 属于某个 openspec change（seed-issues 自动打）

## 多 issue 并行（本地）

- **每 issue 一个 worktree**：`dispatch.mjs` 自动建 `issue/<n>` 分支的 worktree；Claude Code 用户也可 `claude -w`。
- **认领防撞**：一个 issue 同时只允许一个 builder；开工即 worktree 隔离。
- **切分原则**：并行的 issue 应触碰不同目录；同文件的任务串行做——worktree 隔离文件状态，消除不了语义冲突。
- 经验上限：同时 2–4 个会话（本地 rate limit 与人的可审阅性）。

## 观测：中间过程在哪看

- **实时**：watch 把每个子任务（propose / dispatch / review）的全过程输出加 `[#n]` 前缀流在你终端；手动跑 `dispatch.mjs` 时直接继承 stdio。
- **浓缩**：PR 描述 = 单元 journal（含 `Built-by:` 留痕）；issue 评论 = 卡点与提问；顾问评审 = PR 评论。公开 repo 全程可见，任何人可从 issues + PR + checks + git log 重建演变史。

## 模型指定

| 通道 | 方式 |
|---|---|
| 本地 CLI | `claude --model ...` / `codex -m ...`；或在各 CLI 自己的配置里设默认档 |

建议：reviewer 用强模型（量小、质量敏感），builder 用默认档。若要按 issue 固定模型，可在 `scripts/agents.mjs` 的适配器命令里加 `--model`。

## 修复与学习

- **修复**：顾问评审提了意见后，直接 `node scripts/dispatch.mjs <issue#> <同一 builder>` 在同一 worktree 续修（分支已在，续用），或本地进该 worktree 手动接着让 agent 改。
- **学习（ratchet）**：本地通道下不跑云 lesson-capture/retro。教训靠你在有摩擦的 PR 合并后手动开 `type:decision`/issue 记录，或在本地会话里让 agent 提炼 → 落到 AGENTS.md（人审）。review.mjs 在 VERDICT: CHANGES 时会在终端提示这一步（教训闸轮的低摩擦入口）。轻量、按需、零常驻成本。

## 计费

全部走**本地 CLI 的订阅/凭证**（Claude / OpenAI / OpenCode 各自计费）；GitHub 公开 repo 的 Actions 分钟免费；**无按量 API Secret**。成本粒度 = 每个 issue 一次本地 run，靠 issue 粒度纪律控制。
