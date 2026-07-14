import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const TEST_WRITER_LABEL = 'role:test-writer';

const labelsOf = (issue) => (issue.labels || []).map((label) => (
  typeof label === 'string' ? label : label.name
));

export function isTestWriterIssue(issue) {
  return labelsOf(issue).includes(TEST_WRITER_LABEL) || /\[test-writer\]/i.test(issue.title || '');
}

export function extractAcceptanceCriteria(body = '') {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(?:验收判据|acceptance criteria)\s*$/i.test(line));
  if (start < 0) throw new Error('test-writer issue 缺少「## 验收判据」段落');
  const end = lines.findIndex((line, i) => i > start && /^##\s+/.test(line));
  const criteria = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  if (!criteria) throw new Error('test-writer issue 的验收判据为空');
  return criteria;
}

function referencedDeltaSpecPaths(cwd, issue, criteria) {
  const paths = new Set(
    [...criteria.matchAll(/openspec\/changes\/[A-Za-z0-9._-]+\/specs\/[A-Za-z0-9._-]+\/spec\.md/g)]
      .map(([path]) => path),
  );
  const capability = issue.title?.match(/[（(]([^()（）]+)[）)]\s*$/)?.[1];

  for (const label of labelsOf(issue).filter((name) => name?.startsWith('change:'))) {
    const change = label.slice('change:'.length);
    if (!/^[A-Za-z0-9._-]+$/.test(change)) throw new Error(`非法 change label：${label}`);
    const specsDir = join(cwd, 'openspec', 'changes', change, 'specs');
    if (!existsSync(specsDir)) continue;
    const capabilities = capability && existsSync(join(specsDir, capability, 'spec.md'))
      ? [capability]
      : readdirSync(specsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(specsDir, entry.name, 'spec.md')))
        .map((entry) => entry.name)
        .sort();
    for (const name of capabilities) paths.add(`openspec/changes/${change}/specs/${name}/spec.md`);
  }

  if (paths.size === 0) throw new Error('test-writer issue 没有引用可用的 delta spec');
  return [...paths];
}

export function testWriterTaskContext(cwd, issue) {
  const criteria = extractAcceptanceCriteria(issue.body);
  const specs = referencedDeltaSpecPaths(cwd, issue, criteria).map((path) => {
    const fullPath = join(cwd, path);
    if (!existsSync(fullPath)) throw new Error(`test-writer 引用的 delta spec 不存在：${path}`);
    return `### ${path}\n\n${readFileSync(fullPath, 'utf8').trim()}`;
  });
  return [
    '--- 源 issue 验收判据 ---',
    criteria,
    '',
    '--- 引用的 delta specs ---',
    specs.join('\n\n'),
  ].join('\n');
}

export const localCheckNames = (testWriter) => (
  testWriter ? ['typecheck', 'lint', 'acceptance'] : ['typecheck', 'lint', 'test']
);

export function invalidTestWriterChanges(changes) {
  return changes.filter(({ status, path }) => status !== 'A' || !path.startsWith('acceptance/'));
}

export function testWriterScopeCheck(cwd) {
  const base = execFileSync('git', ['-C', cwd, 'merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim();
  const diff = execFileSync('git', ['-C', cwd, 'diff', '--name-status', '--no-renames', base], { encoding: 'utf8' });
  const untracked = execFileSync('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const changes = [
    ...diff.trim().split('\n').filter(Boolean).map((line) => {
      const [status, path] = line.split('\t');
      return { status, path };
    }),
    ...untracked.trim().split('\n').filter(Boolean).map((path) => ({ status: 'A', path })),
  ];
  const invalid = invalidTestWriterChanges(changes);
  if (invalid.length === 0) return { ok: true };
  const detail = invalid.map(({ status, path }) => `${status}\t${path}`).join('\n');
  return {
    ok: false,
    failed: 'workspace-scope',
    command: 'test-writer workspace scope',
    log: [
      '$ test-writer workspace scope',
      '只允许新增 acceptance/** 文件；以下改动越界或不是新增文件：',
      detail,
    ].join('\n'),
  };
}
