import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEW_CHANGES_EXIT, reviewStep, selectReviewer } from './review-policy.mjs';

const source = readFileSync(new URL('./watch.mjs', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const implementationReview = section('function startReview(', '// --- propose：');
const proposalReview = section('function startProposalReview(', 'function startPropose(');
const propose = section('function startPropose(', 'function poll(');

test('proposal success hands the same watch slot to review.mjs', () => {
  assert.match(propose, /if \(code === 0\) return startProposalReview\(num, reviewerLabel\);/);
  assert.match(source, /startPropose\(it\.number, reviewerLabel\)/);
  assert.match(proposalReview, /`propose\/\$\{num\}`/);
  assert.match(proposalReview, /runScript\(num, 'review\.mjs', \[String\(pr\.number\), reviewer\]/);
});

test('proposal reviewer selection prefers --reviewer and otherwise differs from proposer', () => {
  const agents = ['codex', 'claude', 'opencode'];
  assert.equal(selectReviewer({ builtBy: 'codex', agents }), 'claude');
  assert.equal(selectReviewer({ override: 'opencode', labeled: 'claude', builtBy: 'codex', agents }), 'opencode');
  assert.match(proposalReview, /override: REVIEWER, labeled: reviewerLabel, builtBy: BUILDER, agents: AGENTS/);
});

test('all proposal review outcomes are terminal and retain fail-open handoff', () => {
  assert.equal(reviewStep(0, 1), 'pass');
  assert.equal(reviewStep(REVIEW_CHANGES_EXIT, 1), 'changes');
  assert.equal(reviewStep(1, 1), 'failed');
  assert.match(proposalReview, /reviewStep\(code, 1\)/);
  assert.match(proposalReview, /inflight\.delete\(num\)/);
  assert.match(proposalReview, /clearWip\(num\)/);
  assert.match(proposalReview, /setAdvisorStatus\(pr\.number, 'success'/);
  assert.match(proposalReview, /prNote\(pr\.number/);
  assert.doesNotMatch(proposalReview, /startRevision|dispatch\.mjs/);
});

test('implementation review keeps its one-revision path', () => {
  assert.match(implementationReview, /reviewStep\(code, revisionRound\)/);
  assert.match(implementationReview, /if \(step === 'revise'\) return startRevision/);
});
