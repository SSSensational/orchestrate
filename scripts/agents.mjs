#!/usr/bin/env node
// Agent 适配器注册表 —— 本项目产品里 AgentAdapter registry 的退化（单机、单节点、纯本地）形态。
// 每个本地 CLI 知道自己怎么当 builder（可写工作区、自行 commit）或 reviewer（只读分析，产出交给脚本上报）。
// 新增一家本地 CLI = 在 ADAPTERS 里加一条三元组。云通道不在此文件（已按 D9 移出执行面）。
// 注意：键序即缺省优先序——AGENTS[0] 是 watch/propose 未指定时的缺省 agent。
import { execFileSync, spawnSync } from 'node:child_process';

export const ADAPTERS = {
  codex: {
    displayName: 'Codex CLI',
    gitAuthor: { name: 'Codex', email: 'noreply@openai.com' }, // commit 的 author/committer：谁干活谁署名
    // `codex exec` 是非交互模式（无 TTY 可审批），本就不会弹审批——旧版 `--ask-for-approval never`
    // 已在 codex-cli 0.144.1 移除，留着会在参数解析阶段即报错退出。无人值守语义由 `--sandbox workspace-write`
    // （写入限工作区）承载，不再需要审批开关，也不扩大权限。
    build: (prompt) => ['codex', ['exec', '--sandbox', 'workspace-write', prompt]],
    review: (prompt) => ['codex', ['exec', '--sandbox', 'read-only', prompt]],
  },
  claude: {
    displayName: 'Claude Code',
    gitAuthor: { name: 'Claude', email: 'noreply@anthropic.com' },
    // 无头 builder 预设 auto-approve（PRD §3.2 共性）：acceptEdits 只放行编辑、Bash 全被审批墙挡住，
    // agent 连自测/validate 都跑不了。安全 = worktree 隔离 + 平台门禁 + repo deny hooks。
    build: (prompt) => ['claude', ['-p', prompt, '--permission-mode', 'bypassPermissions']],
    review: (prompt) => ['claude', ['-p', prompt, '--permission-mode', 'plan']], // plan = 只读
  },
  opencode: {
    displayName: 'OpenCode',
    gitAuthor: { name: 'OpenCode', email: 'noreply@opencode.ai' },
    build: (prompt) => ['opencode', ['run', prompt]],
    review: (prompt) => ['opencode', ['run', prompt]], // 无只读沙箱——由 review.mjs 放进 PR head 的临时 worktree 硬隔离（写不到主工作树）+ prompt 约束
  },
};

// 以 agent 身份做 git 操作的环境：注入给整个 builder 会话（agent 自己的 commit 也带上）
// 与兜底 commit——author/committer = 干活的 agent。人的 git 身份只出现在人自己的提交与 merge。
export function agentEnv(agentName) {
  const a = ADAPTERS[agentName].gitAuthor;
  return {
    ...process.env,
    GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email,
    GIT_COMMITTER_NAME: a.name, GIT_COMMITTER_EMAIL: a.email,
  };
}

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

// 实时跑（builder）：继承 stdio，全过程在你终端可见。env 用于注入 agent 的 git 身份（agentEnv）。
// 注意：退出码 ≠ 任务成败（opencode 退出码 0 也可能失败，见 PRD §3.2）——dispatch 以本地
// 确定性检查判成败，退出码非 0 只按基础设施故障处理。
export function runLive([cmd, args], cwd, env) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env });
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

// AI 产出的 GitHub 对象（开 PR / 发评论 / 播种 issue）走机器人账号身份：
// 设 AGENT_GH_TOKEN（bot 账号 PAT，repo write 权限、须为 collaborator）即启用；
// 未设则回落人的 gh 登录态（此时靠 PR 正文溯源行标注 AI 身份）。
// 记账类操作（label 交换、查询、push）始终走人的身份。
export function ghAgent(args, opts = {}) {
  const env = process.env.AGENT_GH_TOKEN
    ? { ...process.env, GH_TOKEN: process.env.AGENT_GH_TOKEN }
    : process.env;
  return execFileSync('gh', args, { encoding: 'utf8', env, ...opts });
}
