## 1. 接通 test-writer 派发路径（orchestration scripts）

> 任务 2 的前置：现有 `scripts/dispatch.mjs` 明令禁止 builder 创建或修改 `acceptance/**`，其本地检查环也不运行 `pnpm acceptance`，仓库没有任何 test-writer 派发模式。约束以下方判据为准（tasks.md 播种后不再维护）。

  - [ ] dispatch 支持显式选择的 test-writer 角色：issue 带 `role:test-writer` label 或标题含 `[test-writer]` 标记即选用该模式；无标记的 issue 行为不变，仍禁止触碰 `acceptance/**`
  - [ ] test-writer 的 prompt 只提供源 issue 判据与 delta spec，并明令禁止读取产品实现与既有单元测试
  - [ ] test-writer 工作区改动限定为新增 `acceptance/**` 文件，越界改动在本地检查阶段即失败、不开 PR
  - [ ] test-writer 的本地检查环运行 `pnpm typecheck`、`pnpm lint` 与 `pnpm acceptance`
  - [ ] 该模式复用现有 worktree、PR、回喂与顾问评审流程，watch 对带标记的 ready issue 正常派发
  - [ ] `scripts/seed-issues.mjs` 的任务解析新增回归测试：`## N.` 顶层任务数与标题正确、缩进子判据归属正确、引用块不进正文
  - [ ] 本任务 PR 只修改 `scripts/**` 与必要的运作文档，不修改产品代码、`acceptance/**`、既有测试或 CI workflow
  - [ ] 新行为与本 change 的 orchestration spec delta 一致

## 2. [test-writer] 补齐 workflow-ir M2/M3 独立验收套件（workflow-ir）

> 标题中的 `[test-writer]` 是预埋的机器识别标记：本 issue 在任务 1 落地前就会被播种，dispatch 的 test-writer 模式（任务 1）以该标记选择角色。

  - [ ] 前置：任务 1 的 PR 已合并，本 issue 经由 test-writer 通道派发（在此之前普通 builder 契约禁止触碰 `acceptance/**`，早派发会快速失败）
  - [ ] 测试作者只依据 GitHub #24/#25 的验收判据与 `openspec/changes/single-channel-workflow-slice/specs/workflow-ir/spec.md`，不读取 `shared/src/workflow-ir.ts` 或既有 builder 单元测试来反推实现
  - [ ] 新增的 workflow-ir 验收测试全部位于 `acceptance/**`，每个完整测试标题都包含且仅包含对应来源标记 `#24` 或 `#25`
  - [ ] `#24` 测试覆盖 bundled example 原样通过 L1 且结果与输入深度相等、已知 agent node 增加未知字段后失败，以及每个 L1 error 恰含 `node`、`edge`、`code`、`message` 四键且 locator/code/message 满足 delta 合同
  - [ ] `#25` 成功测试覆盖 bundled example + 满足能力的 Codex registry 零错误通过 L2，以及 `producer -> relay -> consumer` 中 consumer 对 producer 已声明 artifact 的传递上游引用零错误通过
  - [ ] `#25` 失败测试分别覆盖 duplicate id、dangling edge、unreachable node、unresolved template、missing agent 和 missing capability；每类均断言非空稳定 code 与正确非空 locator，dangling edge 须断言与违规边完全相等的 `edge` 对象，后三类的 message 还须包含精确 offending value（能力类 fixture 使用 schema 合法能力值，如 `fork`，registry 中声明为 false）
  - [ ] `#25` 错误码类别测试证明上述六类失败的 `code` 两两互异且重复校验完全一致，且不断言任何字面拼写
  - [ ] `#25` 确定性测试对同一份可产生至少两个 L2 errors 的非法 IR 与同一 registry 连续校验两次，所得完整 error lists 深度相等且顺序一致
  - [ ] 根目录运行 `pnpm test` 退出 0 且不收集任何新增 acceptance 文件或标题；运行 `pnpm acceptance` 收集、执行全部新增测试并退出 0
  - [ ] 与 base 比较的 PR diff 只含 `acceptance/**` 下的新增文件，不修改产品代码、既有测试、配置、依赖、docs 或 OpenSpec，并通过纯测试 PR 的 `test-guard`

## 3. 将 acceptance 套件接入 required CI 并禁止无测试成功（build-pipeline）

> 吸收 issue #45 的范围。

  - [ ] 前置：任务 2 的纯测试 PR 已合并
  - [ ] `pnpm acceptance` 在收集不到任何测试时非零退出
  - [ ] required `ci` 真实执行 `pnpm acceptance`，任一验收测试失败则 `ci` 失败
  - [ ] CI 日志可证明标题含 `#24`/`#25` 的验收测试被执行
  - [ ] 默认 `pnpm test` 继续排除 `acceptance/**`
  - [ ] 与 base 比较的 PR diff 只含 `package.json`、`vitest.acceptance.config.ts` 与 `.github/workflows/ci.yml` 的修改，不修改 `acceptance/**`、产品代码或既有测试
  - [ ] 终审人在合并前把 `Closes #45` 补进本任务 PR body，使 #45 由该合并 PR 关闭
