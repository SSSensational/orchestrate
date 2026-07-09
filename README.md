# Agent Workflow Runtime

可视化、可生成、可验证、可回放的 Agent Workflow Runtime——用声明式 Canonical IR 编排**真实本地 coding agent**（Claude Code / Codex / OpenCode 等 CLI 进程），全过程沉淀为 append-only 事件日志与结构化 artifact，支持暂停、恢复、回放。

- **造什么** → [docs/PRD.md](docs/PRD.md)
- **怎么造** → [docs/ai-native-build.md](docs/ai-native-build.md)：本仓库以 AI-native 方式构建——人只写 spec、验收判据与门禁；实现由**本机 coding CLI（Claude Code / Codex / OpenCode，每 issue 可指定谁 build/review）**完成、经 `gh` 留痕，全部过程（需求、提问、发现、演变）公开在本 repo 的 issues / PRs / checks 上（日常操作见 [docs/operations.md](docs/operations.md)）
- **不可违反原则** → [docs/constitution.md](docs/constitution.md)；**spec 层** → [openspec/](openspec/)（living specs 只描述已建成的现状）
- **日常操作** → [docs/operations.md](docs/operations.md)；**决策记录** → [docs/decisions.md](docs/decisions.md)

> 自指的对称性：构建本项目的基底（issue → 本地 watch 全链自动：提案 / 播种 / dispatch / 顾问评审 → PR → 门禁，人只审两处）正是本项目要造的东西的退化形态——一个没有 DAG、没有 artifact 类型、没有回放的单管线工作流。`scripts/agents.mjs` 的适配器表就是产品 AgentAdapter registry 的退化版。产品把这个基底升维。
