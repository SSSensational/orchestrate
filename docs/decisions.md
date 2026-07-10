# 决策记录

定义本项目当前形态的重大决策。只记录当前有效的决策；被推翻的直接移除。

## D1 Spec 层采用 OpenSpec，不自造、不 fork

直接用 OpenSpec（MIT）的 living specs + changes delta + validate + archive：changes/ 机制解决"跨多 PR 的大变更在途期间 living spec 不能说谎"的两难；纯 markdown 退出成本≈0。用法覆盖两处——tasks.md 仅作播种快照（issue 是唯一活状态）、archive 由 workflow 触发归档任务 issue。

## D2 living specs 从空开始

greenfield 什么都没建成，预填会让 spec 从第一天起说谎、漂移检测失去意义。PRD 作为北极星存 docs/，内容经各 Phase 的 change 提案分批进入，archive 时归并。

## D3 强制层在平台侧，本地 hooks 只作纵深防御

法律 = branch protection + CODEOWNERS（openspec/**、docs/**、.github/**、AGENTS.md、CLAUDE.md）+ 纯确定性 required checks（ci / spec-validate / test-guard）。平台侧门禁对 builder 是谁无感（任一本地 CLI 可随时切换）；.claude / .codex hooks 仅作减噪，不是强制边界。

## D4 文档布局

根目录只留发现约定文件（README / AGENTS.md / CLAUDE.md）；正式文档进 docs/**（CODEOWNERS 人审区）；运作流程文档不进 openspec（openspec 只放产品事实源与产品变更提案）。

## D5 测试作者与实现者分离

验收测试（acceptance/**）由 test-writer（可指定任一本地 CLI，只读判据不看实现）从 issue 判据与 spec 的 GIVEN/WHEN/THEN scenarios 派生，经纯测试 PR 进入并受 test-guard 保护；builder 禁触 acceptance/**，自己写的测试不作为完成依据。理由：同一模型既出题又判卷有 oracle 风险，agent 自评系统性偏乐观。接线（P1 判据）：vitest 默认排除 acceptance/；`pnpm acceptance` 单列；ci 增加 per-issue 的 acceptance check（`--grep "#<n>"`）。

## D6 本地多 issue 并行

每 issue 一个 worktree（dispatch 自动建 `issue/<n>` 分支）；认领防撞，一个 issue 同时只一个 builder；并行的 issue 应触碰不同目录，同 change 串行——worktree 隔离文件状态，消除不了语义冲突。经验上限 2–4 并发（本地 rate limit + 人的可审阅带宽）。

## D7 研究先行（宪法第 9 条）

任何结论性断言（技术选型、架构判断、"X 是主流 / 不需要 / 不可行"）给出前必须取证——检索最新资料与可学习对象、深入代码与文档；结论附来源，取证不可得时显式标注为假设。未经取证直接动手视为违纪，约束人与 agent。

## D8 不整装引入热门 harness 框架

GSD / Superpowers 等与 OpenSpec 同层竞品，叠加即两个事实源；它们的机关在本地会话生命周期，本仓库的执行面在本地 CLI + GitHub 事件面；prompt 级纪律弱于已有的平台级强制；其"builder 自写 failing test"与 D5 冲突。有价值的模式按型吸收（fresh-context、并行审查、评审经济学）——**抄设计，不装依赖**。本地人机交互会话可自由安装增强；执行面与奖励函数层不加。

## D9 定位为作品集 + 纯本地 CLI 通道、门禁去 LLM 化

本项目是**自用 + 面试演示的作品集**（成功 = 做完 + 能演示 + 叙事经得起推敲，非 PMF；该品类反复有人做且不变现，跨厂商控制面之位已被 GitHub Agent HQ 占住）。执行面只用本机 CLI（Claude Code / Codex / OpenCode）、经 `gh` 留痕：托管云 task 无逐步事件流、无公开的程序化 steer/cancel（Codex 本地 app-server 有 turn/steer 与 turn/interrupt——本地通道更可编排）。required checks 纯确定性：LLM 判断非确定、可被 prompt 影响，且模型错误相关（「Great Models Think Alike」）——当门禁是内在矛盾；跨 agent review 降为顾问意见，人终审（宪法第 10 条）。自用威胁模型弱（人盯屏、亲手 merge），不做重装甲平台强制。

## D10 dispatch 内置确定性停机的重试环

开 PR 前本地跑确定性检查（package.json 有 typecheck/lint/test script 就跑，没有就跳过、由远端 required checks 兜底），失败输出截尾回喂同一 worktree 续跑，默认上限 3 次（`DISPATCH_MAX_ATTEMPTS` 可调）；次数用尽自动执行卡住协议（issue 记卡点 + needs-human，不开 PR）。任务成败不以 builder 退出码判定（opencode 退出码 0 也可能失败，PRD §3.2）；退出码非 0 按基础设施故障立即停手。循环的只是确定性信号，不是 LLM 自评（宪法第 10 条）；无界无人值守循环被验收测试与人终审封顶。

## D11 可见验收测试的背题风险 = 已接受的残余风险

acceptance/** 对 builder 可读（公开 repo，无法 held-out）；test-guard 挡「改题」不挡「背题」；不引入隐藏测试套件。前沿模型可打饱和可见测试套件（SpecBench），且没有固定奖励函数能随能力增长保持有效（Verification Horizon）——兜底 = 顾问评审看实现是否泛化 + 人终审；发现背题实例即按宪法第 7 条留痕并升级对策。

## D12 人不碰脚本：watch 单进程打通全链

`watch.mjs` 常驻本机、轮询 GitHub，是全链唯一入口：issue 打 `ready`（无 `change:*` / `agent:build:*`）→ 自动起草提案 PR；提案 merge → 自动播种实现 issues（自带 ready，milestone/phase 取自提案 Refs 的源 issue）；带 `change:*` 或 `agent:build:*` 的 ready issue → dispatch（D10 环）→ 开 PR → 自动顾问评审；同 change 串行（D6）；缺省 builder / reviewer 由 `--builder` / `--reviewer` 指定（当前均缺省 codex；label 优先于缺省，同厂商组合会在评审时告警——需要 D9 的异厂商第二意见时打 label 或换缺省即可）。人保留且仅保留两个动作：**审提案判据（定奖励函数）、终审 merge**；底层脚本降级为调试 / 接管通道。播种与派发触发均为确定性操作（label 协议 + gh 轮询，无 LLM 判断，宪法第 10 条）；失败打 needs-human、不自动重试。
运行约束：**watch 只由人启动，agent 禁止拉起**（AGENTS.md 纪律 7）——它是长驻编排进程，agent 拉起会脱离人的生命周期管理并可能双开。**全机同时只允许一个实例**（`.git/watch.lock` PID 探活锁，重复启动即退出）。**认领必须崩溃可恢复**：认领 = `ready → wip` 标签交换（状态在 GitHub 可见），完成清 `wip`、失败转 `needs-human`；启动时把遗留 `wip` 还原为 `ready` 自动归队（单实例保证了还原的安全性）。dispatch 对已有 open PR 幂等（复用推送，不重复 create）。

## D13 AI 身份：commit author = 干活的 agent；GitHub 对象走机器人账号（可选）

**git 层**：dispatch/propose 给整个 builder 会话与兜底提交注入 `GIT_AUTHOR_* / GIT_COMMITTER_*`（Claude / Codex / OpenCode 各自的 noreply 署名）——谁干活谁署名，无需任何账号；人的 git 身份只出现在人自己的提交与 merge。
**GitHub 层**：评论 / PR / issue 的显示身份 = 认证账号，无法伪装。设 `AGENT_GH_TOKEN`（机器人账号 PAT，repo write、须为 collaborator）后，AI 产出的对象（开 PR、顾问评审评论、卡点评论、播种 issue）以 bot 身份创建；未设则回落人的 gh 登录态 + 正文溯源行。记账操作（label、查询、push）始终走人的身份。附带收益：bot 开的 PR 人可正常 approve——GitHub 禁止自批自己开的 PR，此前 CODEOWNERS 审查在自开 PR 上无法形式化满足。bot 账号只有一个：per-agent 的署名粒度在 commit author 与评论正文头部，不在账号层（多账号违反 GitHub ToS 且徒增凭据管理）。
