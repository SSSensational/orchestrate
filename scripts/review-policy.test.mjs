import test from 'node:test';
import assert from 'node:assert/strict';
import { agentGhEnv } from './agents.mjs';
import {
  REVIEW_CHANGES_EXIT,
  latestChangesFeedback,
  parseReviewVerdict,
  reviewStep,
  selectReviewer,
} from './review-policy.mjs';

test('requires the bot token for AI GitHub writes', () => {
  assert.throws(() => agentGhEnv({}), /AGENT_GH_TOKEN/);
  assert.equal(agentGhEnv({ AGENT_GH_TOKEN: 'bot-token' }).GH_TOKEN, 'bot-token');
});

test('defaults to the first reviewer different from the builder', () => {
  const agents = ['codex', 'claude', 'opencode'];
  assert.equal(selectReviewer({ builtBy: 'codex', agents }), 'claude');
  assert.equal(selectReviewer({ labeled: 'opencode', builtBy: 'codex', agents }), 'opencode');
  assert.equal(selectReviewer({ override: 'codex', labeled: 'opencode', builtBy: 'codex', agents }), 'codex');
});

test('allows one advisory revision before handing changes to the human', () => {
  assert.equal(reviewStep(0, 0), 'pass');
  assert.equal(reviewStep(REVIEW_CHANGES_EXIT, 0), 'revise');
  assert.equal(reviewStep(REVIEW_CHANGES_EXIT, 1), 'changes');
  assert.equal(reviewStep(1, 0), 'failed');
});

test('rejects malformed reviewer output', () => {
  assert.equal(parseReviewVerdict('VERDICT: PASS'), 'pass');
  assert.equal(parseReviewVerdict('VERDICT: CHANGES'), 'changes');
  assert.equal(parseReviewVerdict('looks good'), null);
});

test('selects the latest CHANGES review as builder feedback', () => {
  const comments = [
    { body: '**顾问评审 · Claude**\n\nVERDICT: CHANGES\nfirst' },
    { body: 'human note' },
    { body: '**顾问评审 · Claude**\n\nVERDICT: CHANGES\nlatest' },
  ];
  assert.match(latestChangesFeedback(comments), /latest/);
});
