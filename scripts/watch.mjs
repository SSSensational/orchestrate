#!/usr/bin/env node
// 用法：node scripts/watch.mjs [--interval 30] [--max 2] [--builder claude] [--label ready] [--once] [--dry-run]
//
// 常驻单进程 = 全链入口（决策 D12）。人只碰 GitHub，不敲脚本：
//   issue 打 ready（无 change:* / agent:build:*）→ 自动 propose.mjs 起草提案 PR —— 人审判据
//   提案 PR merge → 检测未播种 change → 自动 seed-issues.mjs 播种实现 issues（自带 ready）
//   issue 打 ready（有 change:* 或 agent:build:*）→ 自动 dispatch.mjs（D10 重试环）
//     → 开 PR → 自动 review.mjs 顾问评审 —— 人终审 merge
// 人保留且仅保留两个动作：审提案判据（定奖励函数）、终审 merge（宪法第 10 条）。
// 同一 change 的 issue 串行派发（worktree 只隔离文件，防不了语义冲突，D6）。
//
// 纯本地、往外轮询 GitHub——你的机器无需公网、无 webhook、无云。
// 认领 = ready → wip 标签交换（状态在 GitHub 可见、崩溃可恢复）；完成清 wip；
// 失败 wip → needs-human、不自动重试（防无人值守烧配额）。启动时把遗留 wip 还原为
// ready（上个 watch 中断的孤儿自动归队）。全机同时只允许一个 watch（PID 锁）。
// **watch 只由人启动——agent 永远不得自行拉起（AGENTS.md 禁止清单）。**
// 底层脚本（propose/seed-issues/dispatch/review）仍可单独手动跑——调试与接管通道。
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { agentFromLabels, AGENTS, gh } from './agents.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const WIP = 'wip';

// --- 参数 ---
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('用法：node scripts/watch.mjs [--interval 30] [--max 2] [--builder codex] [--reviewer codex] [--label ready] [--once] [--dry-run]');
  process.exit(0);
}
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const INTERVAL = Math.max(5, Number(opt('--interval', 30))) * 1000;
const MAX = Math.max(1, Number(opt('--max', 2)));
const LABEL = opt('--label', 'ready');
const BUILDER = opt('--builder', AGENTS[0]);   // issue 没打 agent:build:* 时的缺省 builder
const REVIEWER = opt('--reviewer', AGENTS[0]); // issue/PR 没打 agent:review:* 时的缺省 reviewer（label 优先）
const ONCE = argv.includes('--once');
const DRY = argv.includes('--dry-run');
if (!AGENTS.includes(BUILDER)) { console.error(`未知缺省 builder「${BUILDER}」，可选：${AGENTS.join(' / ')}`); process.exit(1); }
if (!AGENTS.includes(REVIEWER)) { console.error(`未知缺省 reviewer「${REVIEWER}」，可选：${AGENTS.join(' / ')}`); process.exit(1); }

// --- 单实例锁（PID 探活；锁文件在 .git/ 下，不入库）---
const GIT_DIR = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
const LOCK = join(GIT_DIR, 'watch.lock');
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8').trim());
  if (pid && isAlive(pid)) {
    console.error(`已有 watch 在跑（pid ${pid}）——全机同时只允许一个实例。锁：${LOCK}`);
    process.exit(1);
  }
  console.log(`[watch] 残留锁（pid ${pid} 已死）——接管。`);
}
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => {
  try { if (Number(readFileSync(LOCK, 'utf8').trim()) === process.pid) unlinkSync(LOCK); } catch { /* ignore */ }
});

// --- 确保协议 label 存在（幂等）---
try {
  gh(['label', 'create', LABEL, '--force', '--color', '0e8a16',
    '--description', '人已判定可开工：无 change/agent:build 走提案，有则直接实现']);
  gh(['label', 'create', WIP, '--force', '--color', 'd93f0b',
    '--description', 'watch 已认领、执行中；崩溃遗留由下次启动自动还原为 ready']);
} catch { /* 已存在或离线，忽略 */ }

const inflight = new Map(); // issue# -> { child, change }
let stopping = false;
let timer = null;

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (msg) => console.log(`[watch ${stamp()}] ${msg}`);

function maybeExit(code = 0) {
  if (stopping && inflight.size === 0) { log('全部收尾，退出。'); process.exit(code); }
}

// 子进程输出按行加 [#n] 前缀，转发到本终端
function prefixPipe(num, stream, out) {
  let buf = '';
  stream.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { out.write(`[#${num}] ${buf.slice(0, i)}\n`); buf = buf.slice(i + 1); }
  });
  stream.on('end', () => { if (buf) out.write(`[#${num}] ${buf}\n`); });
}

function runScript(num, script, args, onExit) {
  const child = spawn(process.execPath, [join(SCRIPTS, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  prefixPipe(num, child.stdout, process.stdout);
  prefixPipe(num, child.stderr, process.stderr);
  child.on('exit', (code) => onExit(code ?? 1));
  return child;
}

// 认领 = ready → wip（可见、可恢复）；完成清 wip；失败 wip → needs-human
const claim = (num) => { try { gh(['issue', 'edit', String(num), '--remove-label', LABEL, '--add-label', WIP]); } catch { /* ignore */ } };
const clearWip = (num) => { try { gh(['issue', 'edit', String(num), '--remove-label', WIP]); } catch { /* ignore */ } };
const flagHuman = (num) => { try { gh(['issue', 'edit', String(num), '--remove-label', WIP, '--add-label', 'needs-human']); } catch { /* ignore */ } };

// --- 启动恢复：上个 watch 中断遗留的 wip 孤儿，还原 ready 重新排队（单实例保证了安全）---
function recoverOrphans() {
  let orphans = [];
  try {
    orphans = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', WIP,
      '--json', 'number', '--limit', '50']));
  } catch { return; }
  for (const it of orphans) {
    log(`恢复孤儿 #${it.number}（上个 watch 中断遗留）——还原 ${LABEL} 重新排队`);
    if (DRY) continue;
    try { gh(['issue', 'edit', String(it.number), '--remove-label', WIP, '--add-label', LABEL]); } catch { /* ignore */ }
  }
}

// --- 播种：提案 merge 后，openspec/changes/ 里出现还没有对应 issue 的 change ---
function proposalMeta(change) {
  // milestone / phase 取自提案 PR（proposal: <change>）Refs 的源需求 issue；找不到就不挂
  try {
    const prs = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--search', `proposal: ${change} in:title`,
      '--json', 'body', '--limit', '1']));
    const refs = prs[0]?.body?.match(/Refs #(\d+)/i);
    if (!refs) return {};
    const iv = JSON.parse(gh(['issue', 'view', refs[1], '--json', 'milestone,labels']));
    return {
      milestone: iv.milestone?.title,
      phase: (iv.labels || []).map((l) => l.name).find((n) => n.startsWith('phase:')),
    };
  } catch { return {}; }
}

function seedPass() {
  let entries = [];
  try {
    // stderr 静音：changes/ 在远端不存在（空目录不入 git）时 gh 会刷 404
    entries = JSON.parse(gh(['api', 'repos/{owner}/{repo}/contents/openspec/changes'],
      { stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return; } // changes/ 不存在或离线：跳过本轮
  for (const e of entries) {
    if (e.type !== 'dir' || e.name === 'archive') continue;
    const change = e.name;
    let seeded = [];
    try {
      seeded = JSON.parse(gh(['issue', 'list', '--label', `change:${change}`, '--state', 'all',
        '--limit', '1', '--json', 'number']));
    } catch { continue; }
    if (seeded.length) continue;
    if (DRY) { log(`[dry-run] 会播种 change ${change}`); continue; }
    const { milestone, phase } = proposalMeta(change);
    log(`播种 change ${change}${milestone ? ` → milestone「${milestone}」` : ''}`);
    try {
      execFileSync(process.execPath,
        [join(SCRIPTS, 'seed-issues.mjs'), change, milestone || '-', ...(phase ? [phase] : [])],
        { stdio: 'inherit' });
    } catch (e) { log(`✗ 播种 ${change} 失败：${e.message}——下轮重试`); }
  }
}

// --- build：dispatch（重试环）→ 开 PR → 自动顾问评审（复用同一并发槽，串行）---
function startBuild(num, builderLabel, reviewerLabel, change) {
  const args = builderLabel ? [String(num)] : [String(num), BUILDER];
  const child = runScript(num, 'dispatch.mjs', args, (code) => {
    if (code === 0) return startReview(num, reviewerLabel, change);
    inflight.delete(num);
    log(`✗ #${num} dispatch 退出码 ${code} —— 打 needs-human（dispatch 卡住协议已留痕时此操作幂等）`);
    flagHuman(num);
    maybeExit();
  });
  inflight.set(num, { child, change });
  log(`起跑 #${num}（build · ${builderLabel || BUILDER}，在跑 ${inflight.size}/${MAX}）`);
}

function startReview(num, reviewerLabel, change) {
  let pr = null;
  try {
    pr = JSON.parse(gh(['pr', 'list', '--head', `issue/${num}`, '--state', 'open',
      '--json', 'number', '--limit', '1']))[0];
  } catch { /* ignore */ }
  if (!pr) {
    inflight.delete(num);
    clearWip(num);
    log(`⚠ #${num} dispatch 成功但未找到 open PR——请自查`);
    maybeExit();
    return;
  }
  // label 优先：issue 打了 agent:review:* 就让 review.mjs 自己解析；否则传缺省 reviewer
  const args = reviewerLabel ? [String(pr.number)] : [String(pr.number), REVIEWER];
  const child = runScript(num, 'review.mjs', args, (code) => {
    inflight.delete(num);
    clearWip(num);
    log(code === 0
      ? `✓ #${num} → PR #${pr.number} 已开 + 顾问评审已发——等你终审`
      : `✓ #${num} → PR #${pr.number} 已开；⚠ 顾问评审失败（退出码 ${code}），顾问非门禁、可稍后手动补跑 review.mjs`);
    maybeExit();
  });
  inflight.set(num, { child, change });
  log(`#${num} → PR #${pr.number}，自动顾问评审中`);
}

// --- propose：起草提案 PR，之后等人审 ---
function startPropose(num) {
  const child = runScript(num, 'propose.mjs', [String(num), BUILDER], (code) => {
    inflight.delete(num);
    if (code === 0) { clearWip(num); log(`✓ #${num} 提案 PR 已开——审判据 + merge 后自动播种实现 issues`); }
    else { log(`✗ #${num} 提案失败（退出码 ${code}）—— 打 needs-human`); flagHuman(num); }
    maybeExit();
  });
  inflight.set(num, { child, change: null });
  log(`起跑 #${num}（propose · ${BUILDER}，在跑 ${inflight.size}/${MAX}）`);
}

function poll() {
  if (stopping) return;
  seedPass();
  let issues = [];
  try {
    issues = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', LABEL,
      '--json', 'number,title,labels', '--limit', '50']));
  } catch (e) { log(`gh 查询失败（稍后重试）：${e.message}`); return; }

  for (const it of issues) {
    if (inflight.size >= MAX) break;
    if (inflight.has(it.number)) continue;
    const labels = it.labels.map((l) => l.name);
    const change = labels.find((n) => n.startsWith('change:'));
    const builderLabel = agentFromLabels(labels, 'build');
    const reviewerLabel = agentFromLabels(labels, 'review');
    const mode = change || builderLabel ? 'build' : 'propose';
    if (change && [...inflight.values()].some((v) => v.change === change)) {
      log(`跳过 #${it.number}：同 change「${change}」有任务在跑（串行防语义冲突）`);
      continue;
    }
    if (mode === 'propose') {
      // 已有提案（open/merged）就不重复起草；被人关掉（rejected）的允许重新提
      let prior = [];
      try {
        prior = JSON.parse(gh(['pr', 'list', '--head', `propose/${it.number}`, '--state', 'all',
          '--json', 'number,state', '--limit', '5']));
      } catch { /* ignore */ }
      const blocking = prior.find((p) => p.state === 'OPEN' || p.state === 'MERGED');
      if (blocking) {
        // 无事可跑：只摘 ready，不进 wip
        if (!DRY) { try { gh(['issue', 'edit', String(it.number), '--remove-label', LABEL]); } catch { /* ignore */ } }
        log(`#${it.number} 已有提案 PR #${blocking.number}（${blocking.state}）——摘掉 ${LABEL}，等人审/播种`);
        continue;
      }
    }
    if (DRY) {
      log(`[dry-run] 会${mode === 'build' ? `派发（builder=${builderLabel || BUILDER}）` : `起草提案（${BUILDER}）`} #${it.number}：${it.title}`);
      continue;
    }
    claim(it.number); // 认领：起跑前摘 label，避免并发双开 / 下一轮重复捡
    if (mode === 'build') startBuild(it.number, builderLabel, reviewerLabel, change);
    else startPropose(it.number);
  }
}

// --- Ctrl-C 优雅收工 ---
process.on('SIGINT', () => {
  if (!stopping) {
    stopping = true;
    if (timer) clearInterval(timer);
    log(`Ctrl-C：不再捡新活；等待在跑的 ${inflight.size} 个收尾（再按一次 Ctrl-C 强制结束）`);
    maybeExit();
  } else {
    log('强制结束：SIGTERM 在跑的子进程。');
    for (const v of inflight.values()) v.child.kill('SIGTERM');
    process.exit(130);
  }
});

// --- 主循环 ---
log(`启动：label=${LABEL} 并发=${MAX} 缺省builder=${BUILDER} 缺省reviewer=${REVIEWER} 间隔=${INTERVAL / 1000}s pid=${process.pid}`
  + `${ONCE ? ' --once' : ''}${DRY ? ' --dry-run' : ''}`);
log(`流程：ready → 提案（无 change/agent:build）或实现（有）；提案 merge → 自动播种；PR 自动顾问评审；merge 由你终审`);
recoverOrphans();
poll();
if (DRY) { process.exit(0); }
if (ONCE) { stopping = true; maybeExit(); }        // 单趟：等在跑的收尾后退出（适合 cron）
else { timer = setInterval(poll, INTERVAL); }
