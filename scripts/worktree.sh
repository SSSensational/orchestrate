#!/usr/bin/env bash
# 本地并行开工辅助：为 issue 创建隔离 worktree（Claude Code 用户可直接用 `claude -w` 替代；
# 本脚本主要服务 Codex / OpenCode 等其他本地 CLI，统一 issue/<n> 分支命名）。
set -euo pipefail
n="${1:?usage: scripts/worktree.sh <issue-number>}"
dir="../$(basename "$PWD")-issue-${n}"
git worktree add "$dir" -b "issue/${n}"
echo "worktree 就绪：$dir（分支 issue/${n}）"
echo "在该目录启动任一本地 agent，例如：cd $dir && codex"
echo "完成（PR 合并）后清理：git worktree remove $dir"
