#!/usr/bin/env node
// Agent 适配器注册表 —— 本项目产品里 AgentAdapter registry 的退化（单机、单节点、纯本地）形态。
// 每个本地 CLI 知道自己怎么当 builder（可写工作区、自行 commit）或 reviewer（只读分析，产出交给脚本上报）。
// 新增一家本地 CLI = 在 ADAPTERS 里加一条三元组。云通道不在此文件（已按 D9 移出执行面）。
import { execFileSync, spawnSync } from 'node:child_process';

export const ADAPTERS = {
  claude: {
    displayName: 'Claude Code',
    // 无头 builder 预设 auto-approve（PRD §3.2 共性）：acceptEdits 只放行编辑、Bash 全被审批墙挡住，
    // agent 连自测/validate 都跑不了。安全 = worktree 隔离 + 平台门禁 + repo deny hooks。
    build: (prompt) => ['claude', ['-p', prompt, '--permission-mode', 'bypassPermissions']],
    review: (prompt) => ['claude', ['-p', prompt, '--permission-mode', 'plan']], // plan = 只读
  },
  codex: {
    displayName: 'Codex CLI',
    build: (prompt) => ['codex', ['exec', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', prompt]],
    review: (prompt) => ['codex', ['exec', '--sandbox', 'read-only', prompt]],
  },
  opencode: {
    displayName: 'OpenCode',
    build: (prompt) => ['opencode', ['run', prompt]],
    review: (prompt) => ['opencode', ['run', prompt]], // 无只读沙箱——由 review.mjs 放进 PR head 的临时 worktree 硬隔离（写不到主工作树）+ prompt 约束
  },
};

export const AGENTS = Object.keys(ADAPTERS);

// 从 issue/PR 的 labels 里解析某角色对应的 agent：约定 label = `agent:<role>:<name>`
export function agentFromLabels(labels, role) {
  const prefix = `agent:${role}:`;
  const hit = (labels || [])
    .map((l) => (typeof l === 'string' ? l : l && l.name))
    .find((n) => n && n.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

export function resolve(agentName, role, prompt) {
  const a = ADAPTERS[agentName];
  if (!a) throw new Error(`未知 agent「${agentName}」，可选：${AGENTS.join(' / ')}`);
  return a[role](prompt);
}

// 实时跑（builder）：继承 stdio，全过程在你终端可见。
// 注意：退出码 ≠ 任务成败（opencode 退出码 0 也可能失败，见 PRD §3.2）——dispatch 以本地
// 确定性检查判成败，退出码非 0 只按基础设施故障处理。
export function runLive([cmd, args], cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.error) throw new Error(`启动 ${cmd} 失败：${r.error.message}（是否已安装并在 PATH？）`);
  return r.status ?? 0;
}

// 捕获跑（reviewer）：拿 stdout 当评审产出，由调用方上报到 GitHub
export function runCapture([cmd, args], cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`启动 ${cmd} 失败：${r.error.message}（是否已安装并在 PATH？）`);
  return { status: r.status ?? 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}
