## 1. 收紧 workflow-ir L1/L2 并新增 builder 单元测试（builder）

  - [ ] 1.1 依据 GitHub issue #46 与本 change 的 `specs/workflow-ir/spec.md` 实现；builder 提交不得创建、修改或删除 `acceptance/**`，也不得修改任何既有测试。
  - [ ] 1.2 在 `shared/src/workflow-ir.ts` 复用 `^[A-Za-z0-9_-]+$` 标识符 schema 校验 node id、edge endpoint 与 output-artifact name；逐个扫描 prompt 中的 `{{nodes.` candidate，合法形式进入既有上游解析，带点或未闭合形式返回独立、精确、node-located 的 syntax 诊断。
  - [ ] 1.3 仅在 registry 具有对应 agent id 的自有属性时读取 capabilities；空普通对象与自定义原型 entry 均返回 unregistered-agent，真实自有 entry（包括 `toString`）保持可用。
  - [ ] 1.4 按 node/edge 声明顺序对 reachable 子图做确定性 DFS；可达 back edge/self-loop 返回精确 edge-located 的 cycle 诊断，孤立环继续只走既有 unreachable 诊断，P1 任意有向环均不能通过。
  - [ ] 1.5 仅新增一个 `shared/` 下的 builder 单元测试文件覆盖三类修复及重复运行确定性；bundled IR、#24/#25 既有测试、mixed fixture 的五类错误数量/类别/顺序和公开 `{node, edge, code, message}` 合同保持不变。
  - [ ] 1.6 `pnpm typecheck`、`pnpm lint`、`pnpm test` 与现有 `pnpm acceptance` 全部通过；`npx -y @fission-ai/openspec@latest validate --all --strict` 通过，且实现 diff 不引入依赖或修改范围外文件。

## 2. [test-writer] 独立编写 #46 workflow-ir 黑盒验收测试（builder 合并后）

  - [ ] 2.1 仅依据 GitHub issue #46 与本 change 的 `specs/workflow-ir/spec.md` 编写测试；不得阅读 `shared/src/workflow-ir.ts`、builder 单元测试或据实现反推断言，且每个新增测试的完整标题都包含 `#46`。
  - [ ] 2.2 在普通空对象、仅原型继承 entry、同名自有 entry 三种 registry 下分别验证 `toString`/原型碰撞 agent，断言 own-property 注册合同、精确 node locator、offending agent 文本与重复运行深度相等。
  - [ ] 2.3 覆盖允许的下划线/连字符标识符贯通成功，分别覆盖带点 node id、edge endpoint、artifact name 的 L1 拒绝，并覆盖带点 segment、未闭合 candidate 的 L2 syntax 拒绝及合法但 unresolved 引用不被跳过。
  - [ ] 2.4 覆盖 `root -> a -> b -> a`、可达自环、孤立自环三类图，断言前两类返回稳定且精确 edge-located 的 cycle 诊断，孤立自环继续满足既有 unreachable 合同。
  - [ ] 2.5 覆盖 bundled/transitive-upstream 成功、既有 mixed builder fixture 的五类错误与顺序不变，以及新 multi-error 输入的精确公开键集、非空字段、类别区分与重复运行完整列表相等。
  - [ ] 2.6 builder PR 已合并，且本 PR diff 只包含新增的 `acceptance/**` 文件；不得修改产品代码、既有测试、配置、文档或 OpenSpec。`pnpm test` 不收集新增用例，`pnpm acceptance` 收集全部 #46 用例并全部转绿。
