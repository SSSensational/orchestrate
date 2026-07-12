#!/usr/bin/env node
// Agent 适配器注册表 —— 本项目产品里 AgentAdapter registry 的退化（单机、单节点、纯本地）形态。
// 每个本地 CLI 知道自己怎么当 builder（可写工作区、自行 commit）或 reviewer（在一次性 worktree
// 里读码 + 实机执行验证命令，产出交给脚本上报——见 review.mjs）。
// 新增一家本地 CLI = 在 ADAPTERS 里加一条三元组。云通道不在此文件（已按 D9 移出执行面）。
// 注意：键序即缺省优先序——AGENTS[0] 是 watch/propose 未指定时的缺省 agent。
import { execFileSync, spawn, spawnSync } from 'node:child_process';

export const ADAPTERS = {
  codex: {
    displayName: 'Codex CLI',
    gitAuthor: { name: 'Codex', email: 'noreply@openai.com' }, // commit 的 author/committer：谁干活谁署名
    // `codex exec` 是非交互模式（无 TTY 可审批），本就不会弹审批——旧版 `--ask-for-approval never`
    // 已在 codex-cli 0.144.1 移除，留着会在参数解析阶段即报错退出。无人值守语义由 `--sandbox workspace-write`
    // （写入限工作区）承载，不再需要审批开关，也不扩大权限。
    build: (prompt) => ['codex', ['exec', '--sandbox', 'workspace-write', prompt]],
    // reviewer 也要能实机验证（pnpm install/test/smoke），所以同样 workspace-write；
    // 装依赖需要访问 registry，故开 sandbox 内网络。写入仍被限制在一次性 worktree 内。
    review: (prompt) => ['codex', ['exec', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', prompt]],
  },
  claude: {
    displayName: 'Claude Code',
    gitAuthor: { name: 'Claude', email: 'noreply@anthropic.com' },
    // 无头 builder 预设 auto-approve（PRD §3.2 共性）：acceptEdits 只放行编辑、Bash 全被审批墙挡住，
    // agent 连自测/validate 都跑不了。安全 = worktree 隔离 + 平台门禁 + repo deny hooks。
    build: (prompt) => ['claude', ['-p', prompt, '--permission-mode', 'bypassPermissions']],
    // 不用 plan（纯只读，连验证命令都跑不了）也不用 bypassPermissions（连 gh/git push 都放行）：
    // 白名单只放行验证所需命令（pnpm install/test/smoke、node --test、npm view 查 registry），
    // 其余工具在无头模式下自动拒绝——reviewer 能验证，但碰不了 gh、改不了源码。
    // GUI 探索验证：挂 Playwright MCP 经 CDP 接管 Electron 窗口（renderer 即 Chromium）。
    // reviewer 先自行以 --remote-debugging-port=9222 启动 app（见 review.mjs prompt），MCP 首次调用时连接。
    // --strict-mcp-config 隔离掉评审机上碰巧配置的其他 MCP server。GUI lane 目前仅 claude 接了
    // （codex 需 config.toml 配 mcp_servers，opencode 类似——按需再接）。
    review: (prompt) => ['claude', ['-p', prompt,
      '--allowedTools', 'Bash(pnpm:*),Bash(node:*),Bash(npm view:*),mcp__playwright',
      '--mcp-config', '{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest","--cdp-endpoint","http://127.0.0.1:9222"]}}}',
      '--strict-mcp-config']],
  },
  opencode: {
    displayName: 'OpenCode',
    gitAuthor: { name: 'OpenCode', email: 'noreply@opencode.ai' },
    build: (prompt) => ['opencode', ['run', prompt]],
    review: (prompt) => ['opencode', ['run', prompt]], // 无沙箱开关——由 review.mjs 放进 PR head 的一次性 worktree 硬隔离（写不到主工作树）+ prompt 约束
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

// 捕获跑（reviewer）：拿 stdout 当评审产出，由调用方上报到 GitHub。
// detached 起独立进程组：agent CLI 会再拉 shell / MCP server 孙进程，只杀直接子进程会留孤儿——
// 超时（SIGTERM → 10s 宽限 → SIGKILL）与宿主被杀（SIGTERM/SIGINT 转发）都整树击杀，评审不产僵尸。
export function runCapture([cmd, args], cwd, { timeoutMs = 0 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (e) => fail(new Error(`启动 ${cmd} 失败：${e.message}（是否已安装并在 PATH？）`)));
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killTree = (sig) => { try { process.kill(-child.pid, sig); } catch { /* 已退出 */ } };
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        setTimeout(() => killTree('SIGKILL'), 10_000).unref();
      }, timeoutMs)
      : null;
    const onHostSignal = () => { killTree('SIGKILL'); process.exit(143); };
    process.once('SIGTERM', onHostSignal);
    process.once('SIGINT', onHostSignal);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      process.removeListener('SIGTERM', onHostSignal);
      process.removeListener('SIGINT', onHostSignal);
      done({ status: code ?? 0, stdout, stderr, timedOut });
    });
  });
}

export function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}

// advisor-review 存在性门禁（D15）：required commit status，卡「顾问评论已存在（或已明确放弃）」，
// 不卡结论——verdict 永远是顾问意见。SHA 现查现用：复修 push 出新 head 后需新一轮评论才置绿。
// commit status 是记账类操作，走人的 gh 身份（D13）。
export const ADVISOR_CONTEXT = 'advisor-review';
export function setAdvisorStatus(prNum, state, description) {
  const sha = JSON.parse(gh(['pr', 'view', String(prNum), '--json', 'headRefOid'])).headRefOid;
  gh(['api', `repos/{owner}/{repo}/statuses/${sha}`,
    '-f', `state=${state}`, '-f', `context=${ADVISOR_CONTEXT}`,
    '-f', `description=${description.slice(0, 140)}`]);
}

// AI 产出的 GitHub 对象（开 PR / 发评论 / 播种 issue）只走机器人账号身份。
// 记账类操作（label 交换、查询、push）始终走人的身份。
export function agentGhEnv(env = process.env) {
  if (!env.AGENT_GH_TOKEN) {
    throw new Error('缺少 AGENT_GH_TOKEN：拒绝用人的 gh 登录态创建 AI GitHub 对象');
  }
  return { ...env, GH_TOKEN: env.AGENT_GH_TOKEN };
}

export function ghAgent(args, opts = {}) {
  const env = agentGhEnv(opts.env || process.env);
  return execFileSync('gh', args, { encoding: 'utf8', ...opts, env });
}
