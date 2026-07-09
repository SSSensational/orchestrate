#!/usr/bin/env node
// 用法：node scripts/review.mjs <pr#> [claude|codex|opencode]
//
// 用指定 reviewer 只读评审 PR，产出 = 顾问意见（发为 PR 评论）。
// reviewer 由 label `agent:review:<x>` 指定；缺省取「异于 builder」的一家（异厂商第二意见）。
// 重要：这是顾问，不是必过门禁。必过的是确定性检查（ci / spec-validate / test-guard），人终审。
//
// 评审经济学（抄 Superpowers v6 的实测教训，来源见 ai-native-build「来源」节）：
// - reviewer 在 PR head 的临时 detached worktree 里跑：能读实现后的完整代码；任何写入都
//   落不到主工作树——对没有 OS 级只读沙箱的 CLI（opencode）也是硬隔离，评审毕即删。
// - diff / 判据落临时文件传路径，不整段贴进 prompt（贴进去会常驻最贵的上下文）。
// - 对抗式双视角评审（竞争找真实且严重的问题），合并去重后输出。
// - agent 只做只读分析、把评审写到 stdout；由本脚本 gh 上报——agent 不碰网络/gh，真只读。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTERS, AGENTS, agentFromLabels, resolve, runCapture, gh } from './agents.mjs';

const [prNum, override] = process.argv.slice(2);
if (!prNum) {
  console.error('用法：node scripts/review.mjs <pr#> [claude|codex|opencode]');
  process.exit(1);
}

const pr = JSON.parse(gh(['pr', 'view', prNum, '--json', 'title,body,labels,number']));
const prLabels = pr.labels.map((l) => l.name);

// 关联 issue（PR body 的 Closes #n）——判据与 agent:review label 都可能挂在 issue 上
const closes = (pr.body || '').match(/Closes #(\d+)/i);
const builtBy = (pr.body || '').match(/Built-by:\s*(\w+)/i)?.[1];
let issueLabels = [];
let criteria = '{}';
if (closes) {
  try {
    const iv = JSON.parse(gh(['issue', 'view', closes[1], '--json', 'title,body,labels']));
    issueLabels = iv.labels.map((l) => l.name);
    criteria = JSON.stringify({ title: iv.title, body: iv.body });
  } catch { /* issue 读取失败则以 PR 自身为准 */ }
}

let agent = override || agentFromLabels(prLabels, 'review') || agentFromLabels(issueLabels, 'review');
if (!agent) {
  agent = AGENTS.find((a) => a !== builtBy) || AGENTS[0];
  console.log(`未指定 reviewer，默认取异于 builder(${builtBy || '?'}) 的一家：${agent}`);
}
if (!ADAPTERS[agent]) { console.error(`未知 agent「${agent}」，可选：${AGENTS.join(' / ')}`); process.exit(1); }
if (agent === builtBy) {
  console.warn(`⚠ reviewer 与 builder 同为 ${agent}——第二意见的独立性打折（模型盲点相关，见 "Great Models Think Alike"）。`);
}

// 评审材料落临时文件；PR head 检出为临时 detached worktree（不占分支名，不撞 issue/<n> worktree）
const diff = gh(['pr', 'diff', prNum]);
const scratch = mkdtempSync(join(tmpdir(), `review-pr${prNum}-`));
const wtDir = join(scratch, 'head');
const diffFile = join(scratch, 'diff.patch');
const criteriaFile = join(scratch, 'criteria.json');
writeFileSync(diffFile, diff);
writeFileSync(criteriaFile, criteria);
execFileSync('git', ['fetch', 'origin', `pull/${prNum}/head`], { stdio: 'inherit' });
execFileSync('git', ['worktree', 'add', '--detach', wtDir, 'FETCH_HEAD'], { stdio: 'inherit' });

const prompt = [
  '你是独立评审者：只读，不修改任何文件，不开 PR，不跑改动性命令。',
  '当前工作目录是该 PR head 的临时副本（detached worktree），可自由读实现后的完整代码。',
  `待审 diff 在文件 ${diffFile}；验收判据（来源 issue）在 ${criteriaFile}——用读文件工具查看，不要整段复述。`,
  '',
  '方法：用两个独立视角分别评审后合并——视角 A 对照验收判据逐条核收，视角 B 专挑实现问题',
  '（正确性 / 边界 / 糊弄）。两个视角相互竞争：谁找到的真实且严重的问题多算谁赢——宁可尖锐，',
  '不要客套；虚报不算分。最后合并去重输出。',
  '',
  '输出格式：首行必须是 "VERDICT: PASS" 或 "VERDICT: CHANGES"；随后逐条写发现：',
  '① 是否逐条满足验收判据；② 有无 stub / 占位符 / 悄悄砍范围；',
  '③ 行为变更是否同步了对应 openspec spec；④ 有无修改 / 删除既有测试。',
  '记住：你是顾问第二意见，不是必过门禁——确定性检查(ci/spec-validate/test-guard)与人的终审才是关卡。',
].join('\n');

let text = '';
let status = 0;
try {
  console.log(`\n== reviewer：${ADAPTERS[agent].displayName}  ·  PR #${prNum}  ·  ${wtDir}\n`);
  const r = runCapture(resolve(agent, 'review', prompt), wtDir);
  status = r.status;
  text = (r.stdout || '').trim();
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', wtDir]); } catch { /* 兜底：git worktree prune */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
}
if (!text) { console.error(`reviewer 无输出（退出码 ${status}）——未发评论。`); process.exit(1); }

const changes = /VERDICT:\s*CHANGES/i.test(text);
const header =
  `**顾问评审 · ${ADAPTERS[agent].displayName}（本地 CLI）**  ` +
  `— 非必过门禁；必过 = ci / spec-validate / test-guard，人终审。\n\n`;
// 用 pr comment 而非 pr review：自评自审的 PR 上 review 会被 GitHub 拒（不能 approve/request-changes 自己的 PR）。
gh(['pr', 'comment', prNum, '--body', header + text]);
console.log(`\n已发表顾问评审评论（VERDICT: ${changes ? 'CHANGES' : 'PASS'}）。合并与否由你终审。`);
if (changes) {
  console.log('提示（教训闸轮）：若发现具有普适性，开 `type:decision` issue 记录，或合并后提炼进 AGENTS.md（人审）——见 operations「修复与学习」。');
}
