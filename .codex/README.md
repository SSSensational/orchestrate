# Codex 配置

`skills/` 由 `openspec init` 生成（OpenSpec 工作流技能）。

不对 `docs/**` 与 `.github/**` 配置笼统写入 deny；agent 仅在当前 issue
明确列入范围时可在 issue 分支起草，并且必须走 PR。硬边界由 GitHub 平台侧的
branch protection + CODEOWNERS + required checks + 人终审承担，agent 永远不得
直接 push 受保护分支或 merge。见 ai-native-build.md §6。
