# Codex 配置

`skills/` 由 `openspec init` 生成（OpenSpec 工作流技能）。

待办：按 https://developers.openai.com/codex/hooks 配置 PreToolUse deny
（拦对 `docs/**` 与 `.github/**` 的写），与 `.claude/settings.json` 对等。
注意：这是纵深防御层，不是安全边界——主强制层在 GitHub 平台侧
（branch protection + CODEOWNERS + required checks），见 ai-native-build.md §6。
