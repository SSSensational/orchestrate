#!/usr/bin/env bash
# GitHub 侧一次性引导。前提：`gh auth login` 已完成、本地 git 仓库已就绪。
# 用法：./scripts/bootstrap-github.sh [repo-name]   （默认 orchestrate）
set -euo pipefail
REPO_NAME="${1:-orchestrate}"
OWNER="$(gh api user -q .login)"
echo "== owner: ${OWNER}, repo: ${REPO_NAME}"

# 1) 替换 CODEOWNERS 占位符
if grep -q "__OWNER__" .github/CODEOWNERS; then
  sed -i '' "s/__OWNER__/${OWNER}/g" .github/CODEOWNERS
  git add .github/CODEOWNERS
  git commit -m "chore: fill CODEOWNERS owner (${OWNER})"
fi

# 2) 建公开 repo 并推送
gh repo create "${OWNER}/${REPO_NAME}" --public --source . --push \
  --description "Agent Workflow Runtime — orchestrating real local coding agents (Claude Code / Codex / OpenCode). Built AI-natively in the open."

# 3) labels
gh label create "type:feature"          --color 1d76db --force
gh label create "type:bug"              --color d73a4a --force
gh label create "type:question"         --color d4c5f9 --force
gh label create "type:decision"         --color c2e0c6 --force
gh label create "type:drift"            --color fbca04 --force --description "spec 与代码现状的漂移"
gh label create "origin:human"          --color bfdadc --force
gh label create "origin:ai"             --color 7057ff --force
gh label create "needs-human"           --color b60205 --force --description "等待人工答复/裁决"
gh label create "approved-test-change"  --color 0e8a16 --force --description "人工豁免：允许修改既有测试"
gh label create "ready"                 --color 0e8a16 --force --description "人已判定可开工：无 change/agent:build/test-writer 标记走提案，有则直接实现"
gh label create "wip"                   --color d93f0b --force --description "watch 已认领、执行中；崩溃遗留由下次启动自动还原为 ready"
gh label create "role:test-writer"       --color 0e8a16 --force --description "仅新增 acceptance/** 的独立验收测试作者"
# 角色×agent 选择（本地 dispatch 据此选 builder / reviewer，任意组合、非固定）
for a in claude codex opencode; do
  gh label create "agent:build:${a}"    --color 1f6feb --force --description "指定 ${a} 为本 issue 的 builder"
  gh label create "agent:review:${a}"   --color 8250df --force --description "指定 ${a} 为本 issue 的 reviewer（顾问）"
done
for p in P1 P2 P3 P4 P5; do gh label create "phase:${p}" --color ededed --force; done

# 4) milestones（对齐 ai-native-build.md §7）
for t in "P1 单通道跑通" "P2 多 agent 并行 + 工具通道" "P3 gate + 恢复" "P4 画布" "P5 NL→IR"; do
  gh api "repos/${OWNER}/${REPO_NAME}/milestones" -f title="$t" >/dev/null 2>&1 || true
done

# 5) branch protection（main）：required checks + CODEOWNERS 人审
gh api -X PUT "repos/${OWNER}/${REPO_NAME}/branches/main/protection" --input - <<'JSON' \
  || echo "!! branch protection 设置失败——请在 Settings→Branches 手工配置：required checks = ci / spec-validate / test-guard / advisor-review；勾选 Require review from Code Owners"
{
  "required_status_checks": { "strict": false, "contexts": ["ci", "spec-validate", "test-guard", "advisor-review"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "require_code_owner_reviews": true, "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo ""
echo "== 完成。required checks 全为确定性检查（ci / spec-validate / test-guard + advisor-review 存在性门禁）——无需任何 Secret。"
echo "== advisor-review 卡的是「顾问评论已存在」（review.mjs 挂 pending / 置绿），不卡评审结论；超时/失败自动放行 + needs-human（D15）。"
echo "== 剩余手工步骤："
echo "  1. 本机装好要用的 CLI：claude / codex / opencode，并各自登录（用你的订阅/凭证，成本走本地）"
echo "  2. 起常驻进程 node scripts/watch.mjs（只由人启动），之后开 issue 打 ready 即全链自动"
echo "  3. （可选）gh project create --owner ${OWNER} --title 'Agent Workflow Runtime'（需 project scope：gh auth refresh -s project）"
