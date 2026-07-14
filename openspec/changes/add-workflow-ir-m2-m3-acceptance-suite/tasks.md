## 1. 补齐 workflow-ir M2/M3 独立验收套件（workflow-ir）

> 测试作者只依据 GitHub #24/#25 的验收判据与 `openspec/changes/single-channel-workflow-slice/specs/workflow-ir/spec.md`；不得读取 `shared/src/workflow-ir.ts` 或既有 builder 单元测试来反推实现。此任务一次 dispatch、一个纯测试 PR 完成。

- [ ] 新增的 workflow-ir 验收测试全部位于 `acceptance/**`，每个完整测试标题都包含且仅包含对应来源标记 `#24` 或 `#25`
- [ ] `#24` 测试覆盖 bundled example 原样通过 L1 且结果与输入深度相等、已知 agent node 增加未知字段后失败，以及每个 L1 error 恰含 `node`、`edge`、`code`、`message` 四键且 locator/code/message 满足 delta 合同
- [ ] `#25` 成功测试覆盖 bundled example + 满足能力的 Codex registry 零错误通过 L2，以及 `producer -> relay -> consumer` 中 consumer 对 producer 已声明 artifact 的传递上游引用零错误通过
- [ ] `#25` 失败测试分别覆盖 duplicate id、dangling edge、unreachable node、unresolved template、missing agent 和 missing capability；每类均断言非空稳定 code 与正确非空 locator，后三类的 message 还须包含精确 offending value
- [ ] `#25` 错误码类别测试证明上述六类失败的 `code` 两两互异且重复校验完全一致，且不断言任何字面拼写
- [ ] `#25` 确定性测试对同一份可产生至少两个 L2 errors 的非法 IR 与同一 registry 连续校验两次，所得完整 error lists 深度相等且顺序一致
- [ ] 根目录运行 `pnpm test` 退出 0 且不收集任何新增 acceptance 文件或标题；运行 `pnpm acceptance` 收集、执行全部新增测试并退出 0
- [ ] 与 base 比较的 PR diff 只含 `acceptance/**` 下的新增文件，不修改产品代码、既有测试、配置、依赖、docs 或 OpenSpec，并通过纯测试 PR 的 `test-guard`

## 2. 将 acceptance 套件接入 required CI 并禁止无测试成功（build-pipeline）

> 吸收 issue #45 的范围；待任务 1 的纯测试 PR 合并后施工。只允许修改 `package.json`、`vitest.acceptance.config.ts` 与 `.github/workflows/ci.yml`；不得修改 `acceptance/**`、产品代码或既有测试。

- [ ] `pnpm acceptance` 在收集不到任何测试时非零退出
- [ ] required `ci` 真实执行 `pnpm acceptance`，任一验收测试失败则 `ci` 失败
- [ ] CI 日志可证明标题含 `#24`/`#25` 的验收测试被执行
- [ ] 默认 `pnpm test` 继续排除 `acceptance/**`
- [ ] 与 base 比较的 PR diff 只含上述三个文件的修改
