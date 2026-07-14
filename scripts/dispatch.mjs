#!/usr/bin/env node
// 用法：node scripts/dispatch.mjs <issue#> [claude|codex|opencode] [review-pr#]
//
// 本地认领一个 issue，用指定 builder 在隔离 worktree（分支 issue/<n>）实现；开 PR 前先过
// 本地确定性检查（required checks 的本地镜像），红则把失败输出截尾回喂 builder 续跑，
// 次数封顶（决策 D10）。停机条件是确定性的：检查全绿，或次数用尽（→ 自动执行卡住协议）。
// 循环的是确定性信号，不让 LLM 自评「完成」（宪法第 10 条）。
// 全程你在终端可见——纯本地 CLI 通道，无云、无密钥。
// builder 由 issue 的 label `agent:build:<x>` 指定，或用第二参数临时覆盖（任意 CLI，非固定）。
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ADAPTERS, AGENTS, agentEnv, agentFromLabels, agentGhEnv, ghAgent, resolve, runLive, gh } from './agents.mjs';
import {
  isTestWriterIssue,
  localCheckNames,
  testWriterScopeCheck,
  testWriterTaskContext,
} from './dispatch-policy.mjs';
import { latestChangesFeedback } from './review-policy.mjs';

const [num, override, reviewPr] = process.argv.slice(2);
if (!num) {
  console.error('用法：node scripts/dispatch.mjs <issue#> [claude|codex|opencode] [review-pr#]');
  process.exit(1);
}
agentGhEnv();
const MAX_ATTEMPTS = Math.max(1, Number(process.env.DISPATCH_MAX_ATTEMPTS || 3));
// builder 会话硬超时（reviewer 硬超时 D15 的 builder 边）：挂死的 CLI（网络黑洞等）
// 不得无限占用派发槽。0 = 关闭。
const rawTimeout = Number(process.env.BUILDER_TIMEOUT_MINUTES ?? 45);
const TIMEOUT_MIN = Number.isFinite(rawTimeout) && rawTimeout >= 0 ? rawTimeout : 45;

// 1) 读 issue（标题 / 正文=验收判据 / labels）
const issue = JSON.parse(gh(['issue', 'view', num, '--json', 'title,body,labels,number']));
const labels = issue.labels.map((l) => l.name);
const testWriter = isTestWriterIssue(issue);
const agent = override || agentFromLabels(labels, 'build');
if (!agent) {
  console.error(`issue #${num} 未指定 builder。请打 label agent:build:<${AGENTS.join('|')}>，或传第二参数。`);
  process.exit(1);
}
if (!ADAPTERS[agent]) { console.error(`未知 agent「${agent}」，可选：${AGENTS.join(' / ')}`); process.exit(1); }

let reviewFeedback = null;
if (reviewPr) {
  const { comments } = JSON.parse(gh(['pr', 'view', reviewPr, '--json', 'comments']));
  reviewFeedback = latestChangesFeedback(comments);
  if (!reviewFeedback) {
    console.error(`PR #${reviewPr} 没有可回喂的 VERDICT: CHANGES 顾问评论`);
    process.exit(1);
  }
}

// 2) 建隔离 worktree（分支 issue/<n>，基于 origin/main——本地 main 可能过期/被重写）
// 认领防撞：一个 issue 同时只一个 builder
const dir = `../${basename(process.cwd())}-issue-${num}`;
if (!existsSync(dir)) {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main']);
  const branchExists = spawnSync('git', ['rev-parse', '--verify', `issue/${num}`]).status === 0;
  const args = branchExists
    ? ['worktree', 'add', dir, `issue/${num}`]
    : ['worktree', 'add', dir, '-b', `issue/${num}`, 'origin/main'];
  execFileSync('git', args, { stdio: 'inherit' });
} else {
  console.log(`worktree 已存在：${dir}（续用）`);
}

// 3) 纪律块（初始与续跑 prompt 共用；agent 中立：任一 CLI 读同一份）
const DISCIPLINE = (testWriter ? [
  '--- test-writer 纪律（详见仓库根 AGENTS.md）---',
  '- 任务判定依据仅限本 prompt 提供的源 issue 验收判据与引用的 delta specs。',
  '- 禁止读取产品实现文件与既有单元/集成测试；不得从实现或 builder 测试反推断言。',
  '- 工作区只允许新增 acceptance/** 文件；禁止修改/删除既有文件，禁止改动任何其他路径。',
  '- 在本 worktree 内实现 + 自测 + git commit（分支已建好；PR 由本脚本创建，你不要自己开 PR）。',
  '- 卡住同一错误两次：在 issue 评论记录卡点、打 needs-human label、停手。',
] : [
  '--- 纪律（详见仓库根 AGENTS.md）---',
  '- 一次只做这一个 issue，只改必要范围；不顺手重构、不修范围外问题。',
  '- 禁止占位符 / stub；改行为必须同步对应 openspec spec。',
  '- 禁止创建 / 修改 / 删除 acceptance/**（验收测试由 test-writer 拥有，test-guard 强制）。',
  '- 在本 worktree 内实现 + 自测 + git commit（分支已建好；PR 由本脚本创建，你不要自己开 PR）。',
  '- 卡住同一错误两次：在 issue 评论记录卡点、打 needs-human label、停手。',
]).join('\n');
const taskContext = testWriter ? testWriterTaskContext(dir, issue) : (issue.body || '');

// 普通 builder 跑 required checks 的本地镜像；test-writer 先验工作区范围，再跑其专用命令集。
// 普通脚手架未落地（无 package.json 或无对应 script）时跳过——远端 required checks 仍兜底。
function localChecks(cwd, forTestWriter) {
  if (forTestWriter) {
    const scope = testWriterScopeCheck(cwd);
    if (!scope.ok) return scope;
  }
  const pkg = join(cwd, 'package.json');
  if (!existsSync(pkg)) return forTestWriter
    ? { ok: false, failed: 'check-contract', command: 'test-writer local checks', log: 'package.json 不存在，无法运行 test-writer 必需检查' }
    : { ok: true, skipped: true };
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(pkg, 'utf8')).scripts || {}; } catch (error) {
    return forTestWriter
      ? { ok: false, failed: 'check-contract', command: 'test-writer local checks', log: `package.json 无法解析：${error.message}` }
      : { ok: true, skipped: true };
  }
  const required = localCheckNames(forTestWriter);
  const missing = required.filter((name) => !scripts[name]);
  if (forTestWriter && missing.length) {
    return {
      ok: false,
      failed: 'check-contract',
      command: 'test-writer local checks',
      log: `package.json 缺少 test-writer 必需 scripts：${missing.join(', ')}`,
    };
  }
  const names = required.filter((name) => scripts[name]);
  if (names.length === 0) return { ok: true, skipped: true };
  for (const name of names) {
    // 不加 -s：静默模式会吞掉 run 前置阶段（自动 pnpm install 等）的报错，
    // 失败时零输出 → 回喂 builder 的日志为空，修复环变成盲修（issue #26 实例）
    const r = spawnSync('pnpm', ['run', name], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if ((r.status ?? 1) !== 0) {
      console.error(`✗ 本地检查未过：pnpm run ${name}`);
      const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
      return { ok: false, failed: name, command: `pnpm run ${name}`, log: `$ pnpm run ${name}\n${out
        || '（检查失败但无任何输出——命令可能未真正运行：依赖安装失败、pnpm 不在 PATH 等环境问题，先排查环境而非改代码）'}` };
    }
    console.log(`✓ 本地检查：pnpm run ${name}`);
  }
  return { ok: true, skipped: false, checked: names };
}

const tail = (s, n) => s.split('\n').slice(-n).join('\n');
const failedCommand = (result) => result.command || `pnpm run ${result.failed}`;

// 4) 重试环：builder 会话 → 本地确定性检查 → 红则失败截尾回喂续跑（≤ MAX_ATTEMPTS）。
// 成败不以 builder 退出码判定（opencode 退出码 0 也可能失败，见 PRD §3.2）；
// 退出码非 0 按基础设施故障处理（CLI 未装 / 未登录 / 崩溃），立即停手交人，不计入重试。
let prompt = reviewFeedback
  ? [
      `复修 GitHub issue #${num}：${issue.title}`,
      '',
      taskContext,
      '',
      '下面是顾问对当前 PR 的 CHANGES 意见。逐条判断：有依据的做最小修复；不成立的不要盲从，保留实现交由复审和人终审。',
      '',
      '--- 顾问评审 ---',
      reviewFeedback,
      '',
      DISCIPLINE,
    ].join('\n')
  : [
      `完成 GitHub issue #${num}：${issue.title}`,
      '',
      taskContext,
      '',
      DISCIPLINE,
    ].join('\n');
let checks = { ok: true, skipped: true };
for (let attempt = 1; ; attempt++) {
  console.log(`\n== builder：${ADAPTERS[agent].displayName}  ·  issue #${num}  ·  ${dir}  ·  尝试 ${attempt}/${MAX_ATTEMPTS}${TIMEOUT_MIN ? `  ·  限时 ${TIMEOUT_MIN}min` : ''}\n`);
  const { status: code, timedOut } = await runLive(resolve(agent, 'build', prompt), dir, agentEnv(agent),
    { timeoutMs: TIMEOUT_MIN * 60_000 });
  if (timedOut) { console.error(`\nbuilder 超时（${TIMEOUT_MIN} 分钟）——已整树终止，按基础设施故障处理；未开 PR。`); process.exit(1); }
  if (code !== 0) { console.error(`\nbuilder 退出码 ${code}（按基础设施故障处理）——检查上面输出；未开 PR。`); process.exit(code); }
  checks = localChecks(dir, testWriter);
  if (checks.ok) break;
  if (attempt >= MAX_ATTEMPTS) {
    // 卡住协议的机器执行版（AGENTS.md 纪律 6）：记录卡点、打 needs-human、停手，不开 PR
    const body = [
      `**dispatch 卡住**：${MAX_ATTEMPTS} 次尝试后本地确定性检查仍未过（builder=${agent}）。`,
      '',
      `最后一次失败（\`${failedCommand(checks)}\`，截尾）：`,
      '',
      '```',
      tail(checks.log, 60),
      '```',
      '',
      `worktree 保留在本地 \`${dir}\`（分支 \`issue/${num}\`），可人工接手，或换 builder 重跑 dispatch（续用同一 worktree）。`,
    ].join('\n');
    try {
      ghAgent(['issue', 'comment', num, '--body', body]); // 卡点评论 = AI 产出，有 bot token 时以 bot 身份发
      gh(['issue', 'edit', num, '--add-label', 'needs-human']);
    } catch (e) { console.error(`（gh 留痕失败：${e.message}）`); }
    console.error(`\n${MAX_ATTEMPTS} 次尝试后检查仍未过——已在 issue 记录卡点并打 needs-human；未开 PR。`);
    process.exit(1);
  }
  console.log(`\n== 检查未过（${failedCommand(checks)}）——失败输出截尾回喂 builder 续跑\n`);
  prompt = [
    `继续 GitHub issue #${num}：${issue.title}`,
    '',
    ...(testWriter ? [taskContext, ''] : []),
    `本 worktree 已有一版实现，但本地确定性检查未过（${failedCommand(checks)}）。`,
    '只修检查暴露的问题，不扩大范围；修完自己重跑该检查确认后再收尾。',
    '',
    '--- 检查失败输出（截尾）---',
    tail(checks.log, 120),
    '',
    DISCIPLINE,
  ].join('\n');
}

// 5) 兜底提交（agent 若留了未提交改动，替它 commit，避免空 PR；author/committer = 干活的 agent）
const dirty = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
if (dirty) {
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-m', `issue #${num}: ${issue.title}`],
    { stdio: 'inherit', env: agentEnv(agent) });
}

// 6) 推分支 + 开 PR（已有 open PR 则复用——续修 / 崩溃恢复时推送即更新）
execFileSync('git', ['-C', dir, 'push', '-u', 'origin', `issue/${num}`], { stdio: 'inherit' });
const existing = JSON.parse(gh(['pr', 'list', '--head', `issue/${num}`, '--state', 'open',
  '--json', 'url', '--limit', '1']));
let url;
if (existing.length) {
  url = existing[0].url;
  console.log(`\nPR 已存在（推送即更新）：${url}`);
} else {
  const checksLine = checks.skipped
    ? 'Local-checks: skipped（脚手架未落地，无 package.json scripts；由远端 required checks 兜底）'
    : `Local-checks: green（${checks.checked.join(' / ')}）`;
  const body = [
    `Closes #${num}`,
    '',
    `Built-by: ${agent} (${ADAPTERS[agent].displayName} · 本地 CLI 通道)`,
    checksLine,
    '',
    '> 由 scripts/dispatch.mjs 开出。评审：`node scripts/review.mjs <本 PR#>`。',
    '> 合并前须 ci + spec-validate + test-guard 全绿；LLM 评审为顾问意见；人终审。',
  ].join('\n');
  url = ghAgent(['pr', 'create', '--head', `issue/${num}`, '--title', issue.title, '--body', body], { cwd: dir }).trim();
  console.log(`\nPR 已创建：${url}`);
}
console.log(`下一步：node scripts/review.mjs ${url.split('/').pop()}  [reviewer]`);
