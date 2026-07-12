#!/usr/bin/env node
// 用法：node scripts/seed-issues.mjs <change-name> [milestone-title|-] [phase-label|-] [parent-issue#]
// 读取 openspec/changes/<change>/tasks.md（本地没有就取 origin/main——watch 自动播种时
// 提案刚在 GitHub 上 merge、本地未必 pull 过），把每条顶层 task 播种为 GitHub Issue：
//   标题 = task 文本；正文 = 子项（作为验收判据 checklist）+ 回链。
//   labels: type:feature origin:human change:<name> ready [phase:<Pn>]，可选挂 milestone。
//   自带 ready：判据已在提案 PR 人审定稿，播种即可开工——watch 会自动逐个派发（D12）。
//   传了 parent-issue# 时，播种出的 issue 挂为其 sub-issues——父 issue 上有树形列表与
//   进度条，手机可见；挂接失败降级为普通播种（组织手段，非门禁）。
// 播种后 Issue 是唯一活状态，tasks.md 不再维护（AGENTS.md「Spec 层」）。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { agentGhEnv, gh, ghAgent } from './agents.mjs';

const [change, milestoneArg, phaseArg, parentArg] = process.argv.slice(2);
if (!change) {
  console.error('usage: node scripts/seed-issues.mjs <change-name> [milestone-title|-] [phase-label|-] [parent-issue#]');
  process.exit(1);
}
agentGhEnv();
const milestone = milestoneArg && milestoneArg !== '-' ? milestoneArg : null;
const phase = phaseArg && phaseArg !== '-' ? phaseArg : null;
const parent = parentArg && parentArg !== '-' ? Number(parentArg) : null;
if (parentArg && parentArg !== '-' && !Number.isInteger(parent)) {
  console.error(`parent-issue# 必须是 issue 编号，收到「${parentArg}」`);
  process.exit(1);
}

const path = `openspec/changes/${change}/tasks.md`;
let md;
if (existsSync(path)) {
  md = readFileSync(path, 'utf8');
} else {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main']);
  md = execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8' });
}
const tasks = [];
let cur = null;
for (const line of md.split('\n')) {
  const top = line.match(/^(?:#+\s*\d+[.)]?\s+(.+)|- \[[ x]\] (.+))$/);
  const sub = line.match(/^\s+- (?:\[[ x]\] )?(.+)/);
  if (top) {
    cur = { title: (top[1] || top[2]).trim(), subs: [] };
    tasks.push(cur);
  } else if (sub && cur) {
    cur.subs.push(sub[1].trim());
  }
}
if (tasks.length === 0) {
  console.error(`openspec/changes/${change}/tasks.md 里没有解析到任务`);
  process.exit(1);
}

const labels = ['type:feature', 'origin:human', `change:${change}`, 'ready', ...(phase ? [phase] : [])];
execFileSync('gh', ['label', 'create', `change:${change}`, '--force', '--color', '5319e7',
  '--description', `openspec change ${change}`], { stdio: 'inherit' });
execFileSync('gh', ['label', 'create', 'ready', '--force', '--color', '0e8a16',
  '--description', '人已判定可开工：无 change/agent:build 走提案，有则直接实现'], { stdio: 'inherit' });

for (const t of tasks) {
  const body = [
    `来自 change \`${change}\`（openspec/changes/${change}/，tasks.md 为初始快照，活状态以本 issue 为准）。`,
    '',
    '## 验收判据',
    ...(t.subs.length
      ? t.subs.map((s) => `- [ ] ${s}`)
      : ['- [ ] （待补充——合并前必须可由 CI / 测试 / 可观察行为证实）']),
  ].join('\n');
  const url = ghAgent(['issue', 'create', '--title', t.title, '--body', body,
    ...(milestone ? ['--milestone', milestone] : []),
    ...labels.flatMap((l) => ['--label', l])]).trim(); // 播种 = AI 产出，走 bot 身份（D13）
  console.log(url);
  // 挂为源需求 issue 的 sub-issue：父 issue 上可见"一个需求 → N 个实现"的树与进度条。
  // 挂接 = 记账操作，走人的 gh 身份（D13）；fail-open——组织手段非门禁，失败只警告。
  if (parent) {
    const num = Number(url.split('/').pop());
    try {
      const { id } = JSON.parse(gh(['api', `repos/{owner}/{repo}/issues/${num}`]));
      gh(['api', '-X', 'POST', `repos/{owner}/{repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${id}`],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      console.error(`⚠ #${num} 挂接为 #${parent} 的 sub-issue 失败：${e.message}——已按普通 issue 播种`);
    }
  }
}
console.log(`已播种 ${tasks.length} 个 issue（change:${change}${milestone ? ` → milestone「${milestone}」` : ''}${parent ? `，挂为 #${parent} 的 sub-issues` : ''}，自带 ready——watch 会自动派发）`);
