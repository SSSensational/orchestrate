# Constitution — 不可违反原则

约束本仓库全部 agent 与自动化的宪法。与 prompt 或技能指引冲突时，以本文为准；本文与 `.github/` 门禁的变更必须经人审（CODEOWNERS）。

1. **Spec 是事实源**。`openspec/specs/` 的 living spec 只描述"已建成的现状"；在途意图放 `openspec/changes/`。改行为的 PR 必须同步对应 spec，否则不得合并。
2. **禁止占位符与 stub**。不实现完整功能就不要声称完成；不得为通过编译或测试而糊弄实现。
3. **禁止悄悄砍范围**。验收判据在 proposal PR 定稿、先于实现存在；做不到就在 issue 里说明并等人裁决。
4. **测试所有权分离**。验收测试（acceptance/**）由 test-writer 从判据与 scenarios 派生，实现者不得创建、修改、删除；修改其他既有测试必须由人显式豁免（`approved-test-change` label，由人打）。
5. **产出只经 PR**。禁止直推受保护分支；禁止 merge；禁止手动关闭 issue（issue 只能被合并的 PR 关闭）。
6. **门禁不可自改**。`openspec/**`、`docs/**`（含本文与 PRD）、`.github/**`、`AGENTS.md` 的变更必须经人审合并。
7. **失败要留痕**。卡住两次即在 issue 记录并退出本次 run；不无限重试；不隐瞒失败的测试或跳过的步骤。
8. **公开优先**。决策、提问、发现一律落在 GitHub 对象（issue / PR / 评论）上，不留在会话里。
9. **研究先行，反对想当然**。任何结论性断言（技术选型、架构判断、"X 是主流 / 不需要 / 不可行"）给出之前必须取证：检索最新资料与可学习的同类项目、深入相关代码与文档分析；结论附来源，取证不可得时显式标注为假设。未经取证直接动手（下结论、写文档、写代码）视为违纪——这条同样约束人与 agent。
10. **奖励函数是确定性的；LLM 审查是顾问，人是终审**。必过门禁（required checks）只由确定性检查构成：`ci`（typecheck / lint / test，含验收测试）、`spec-validate`、`test-guard`。跨 agent 的 review / verify 产出的是顾问意见与第二视角，**一律不作为必过门禁、不进合并关键路径**；PR 是否合并由人终审。不得把非确定性的 LLM 判断包装成"法律"。
11. **Commit message 一律用英文**。所有 Git commit message（标题与正文）必须用英文书写。issue、PR 描述、评论等其他 GitHub 对象不受此条约束。
