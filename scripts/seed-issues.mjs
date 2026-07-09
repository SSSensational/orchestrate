#!/usr/bin/env node
// 用法：node scripts/seed-issues.mjs <change-name> [milestone-title|-] [phase-label]
// 读取 openspec/changes/<change>/tasks.md（本地没有就取 origin/main——watch 自动播种时
// 提案刚在 GitHub 上 merge、本地未必 pull 过），把每条顶层 task 播种为 GitHub Issue：
//   标题 = task 文本；正文 = 子项（作为验收判据 checklist）+ 回链。
//   labels: type:feature origin:human change:<name> ready [phase:<Pn>]，可选挂 milestone。
//   自带 ready：判据已在提案 PR 人审定稿，播种即可开工——watch 会自动逐个派发（D12）。
// 播种后 Issue 是唯一活状态，tasks.md 不再维护（AGENTS.md「Spec 层」）。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [change, milestoneArg, phase] = process.argv.slice(2);
if (!change) {
  console.error('usage: node scripts/seed-issues.mjs <change-name> [milestone-title|-] [phase-label]');
  process.exit(1);
}
const milestone = milestoneArg && milestoneArg !== '-' ? milestoneArg : null;

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
  execFileSync('gh', ['issue', 'create', '--title', t.title, '--body', body,
    ...(milestone ? ['--milestone', milestone] : []),
    ...labels.flatMap((l) => ['--label', l])], { stdio: 'inherit' });
}
console.log(`已播种 ${tasks.length} 个 issue（change:${change}${milestone ? ` → milestone「${milestone}」` : ''}，自带 ready——watch 会自动派发）`);
