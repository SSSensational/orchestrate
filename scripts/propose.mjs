#!/usr/bin/env node
// 用法：node scripts/propose.mjs <issue#> [claude|codex|opencode]
//
// 从一个「我要 X」的需求 issue 起草 openspec change 提案，用本地 CLI 在隔离 worktree
// （分支 propose/<n>）产出 openspec/changes/<name>/（proposal + design + spec delta + tasks），
// 完成后开「提案 PR」（Refs #n）。全程你在终端可见——纯本地 CLI 通道，无云、无密钥。
//
// 与 dispatch.mjs 对称：dispatch 从 issue 触发「实现」，propose 从 issue 触发「定义奖励函数」。
// 提案 PR 合并 = 人审定判据（走 spec-validate + CODEOWNERS）；合并后 seed-issues 播种实现 issue。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { ADAPTERS, AGENTS, agentFromLabels, resolve, runLive, gh } from './agents.mjs';

const [num, override] = process.argv.slice(2);
if (!num) {
  console.error('用法：node scripts/propose.mjs <issue#> [claude|codex|opencode]');
  process.exit(1);
}

// 1) 读需求 issue（标题 / 正文=需求描述 / labels）
const issue = JSON.parse(gh(['issue', 'view', num, '--json', 'title,body,labels,number']));
const labels = issue.labels.map((l) => l.name);
// 起草者复用 build 角色适配器（需可写工作区）；agent 取 agent:build label 或第二参数，缺省 claude。
let agent = override || agentFromLabels(labels, 'build');
if (!agent) {
  agent = AGENTS[0];
  console.log(`issue #${num} 未指定 agent:build label，默认用「${agent}」起草（可传第二参数覆盖）。`);
}
if (!ADAPTERS[agent]) { console.error(`未知 agent「${agent}」，可选：${AGENTS.join(' / ')}`); process.exit(1); }

// 2) 建隔离 worktree（分支 propose/<n>，基于 origin/main——本地 main 可能过期/被重写）
const dir = `../${basename(process.cwd())}-propose-${num}`;
if (!existsSync(dir)) {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main']);
  const branchExists = spawnSync('git', ['rev-parse', '--verify', `propose/${num}`]).status === 0;
  const args = branchExists
    ? ['worktree', 'add', dir, `propose/${num}`]
    : ['worktree', 'add', dir, '-b', `propose/${num}`, 'origin/main'];
  execFileSync('git', args, { stdio: 'inherit' });
} else {
  console.log(`worktree 已存在：${dir}（续用）`);
}

// 3) 组 prompt = 需求 + openspec propose 契约 + 纪律（agent 中立：任一 CLI 都装了 openspec-propose 技能）
const prompt = [
  `为下面这个需求起草一个 OpenSpec change 提案。需求来自 GitHub issue #${num}：${issue.title}`,
  '',
  '--- 需求正文 ---',
  issue.body || '(正文为空——以标题为准，不足处按你调研补全并在 proposal 里标注假设)',
  '',
  '--- 要产出什么（遵循本仓库已装的 openspec-propose 技能与 openspec/ 约定）---',
  '在 openspec/changes/<kebab-change-name>/ 下创建：',
  '- proposal.md：Why（动机）/ What Changes（改什么）/ Impact（影响面）。',
  '- design.md：仅当有非平凡技术取舍时写（取证结论附来源，无则可省）。',
  '- specs/<capability>/spec.md：spec delta，用 "## ADDED Requirements"，每条 Requirement 下至少一个',
  '  "#### Scenario:"，正文写 GIVEN / WHEN / THEN——scenarios 会被 test-writer 直接派生成验收测试，务必可判定。',
  '- tasks.md：有序的顶层任务（每条一行），子项写成该任务的验收判据 checklist。这是播种成 issue 的初始快照。',
  '',
  '产出后本地校验：npx -y @fission-ai/openspec@latest validate --all --strict —— 必须过。',
  '',
  '--- 纪律（详见仓库根 AGENTS.md 与 constitution）---',
  '- 这份提案定义的是「奖励函数」（验收判据先于实现存在）——判据要能被 CI / 测试 / 可观察行为证实，禁止含糊。',
  '- 研究先行：结论性断言（选型、"X 是主流/不可行"）先取证附来源，取证不可得显式标注假设；不许想当然。',
  '- 禁止占位符 / stub；不要顺手改 openspec/changes/ 以外的东西。',
  '- 只在本 worktree 内写文件 + git commit（分支已建好；PR 由本脚本创建，你不要自己开 PR）。',
  '- 卡住同一错误两次：在 issue 评论记录卡点、打 needs-human label、停手。',
].join('\n');

// 4) 跑起草者（可写工作区，实时可见）
console.log(`\n== proposer：${ADAPTERS[agent].displayName}  ·  issue #${num}  ·  ${dir}\n`);
const code = runLive(resolve(agent, 'build', prompt), dir);
if (code !== 0) { console.error(`\nproposer 退出码 ${code}——检查上面输出；未开 PR。`); process.exit(code); }

// 5) 兜底提交（agent 若留了未提交改动，替它 commit；trailer 标注实际作者是谁）
const dirty = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
if (dirty) {
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit',
    '-m', `propose: openspec change for issue #${num}`,
    '-m', `Co-Authored-By: ${ADAPTERS[agent].coauthor}`], { stdio: 'inherit' });
}

// 6) 探测本次新增的 change 目录名（openspec/changes/<name>/…）——用于 PR 标题与下一步命令
const changed = spawnSync('git', ['-C', dir, 'diff', '--name-only', 'origin/main', '--', 'openspec/changes/'],
  { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
const names = [...new Set(changed.map((p) => p.split('/')[2]).filter(Boolean))]
  .filter((n) => n !== 'archive');
if (names.length === 0) {
  console.error('\n未在 openspec/changes/ 下探测到新 change——检查上面输出；未开 PR。');
  process.exit(1);
}
if (names.length > 1) {
  console.warn(`⚠ 探测到多个 change 目录：${names.join(', ')}——提案应单一，请检查后自行开 PR。`);
}
const change = names[0];

// 7) 推分支 + 开「提案 PR」（Refs #n，非 Closes——合并提案不关需求 issue）
execFileSync('git', ['-C', dir, 'push', '-u', 'origin', `propose/${num}`], { stdio: 'inherit' });
const body = [
  `提案 change \`${change}\` —— 定义奖励函数（验收判据），实现前人审。`,
  '',
  `Refs #${num}`,
  '',
  `Proposed-by: ${agent} (${ADAPTERS[agent].displayName} · 本地 CLI 通道)`,
  '',
  '> 由 scripts/propose.mjs 从需求 issue 起草。合并前须 spec-validate 全绿 + CODEOWNERS 人审',
  '> （这一步 = 定下「什么算完成」，先于实现）。',
  `> 合并后：\`node scripts/seed-issues.mjs ${change} "<里程碑>"\` 播种实现 issue → dispatch。`,
].join('\n');
const url = gh(['pr', 'create', '--head', `propose/${num}`, '--title', `proposal: ${change}`, '--body', body],
  { cwd: dir }).trim();
console.log(`\n提案 PR 已创建：${url}`);
console.log(`合并后：node scripts/seed-issues.mjs ${change} "<里程碑>"`);
