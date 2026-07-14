import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import approvalPolicy from '../.github/test-guard-approval.cjs';

const { hasAuthorizedTestChangeApproval } = approvalPolicy;

const event = (actor = {}) => ({
  event: 'labeled',
  label: { name: 'approved-test-change' },
  actor: { type: 'User', ...actor },
});

test('authorizes only the configured human CODEOWNER ID', () => {
  assert.equal(hasAuthorizedTestChangeApproval([event({ id: 37439786, login: 'SSSensational' })]), true);
  assert.equal(hasAuthorizedTestChangeApproval([event({ id: 112002218, login: 'uuiodwae' })]), false);
});

test('ignores actor login and display-name presentation', () => {
  assert.equal(hasAuthorizedTestChangeApproval([event({
    id: 37439786,
    login: 'renamed-owner',
    name: 'Changed display name',
  })]), true);
  assert.equal(hasAuthorizedTestChangeApproval([event({ id: 37439786 })]), true);
  assert.equal(hasAuthorizedTestChangeApproval([event({
    id: 112002218,
    login: 'SSSensational',
    name: 'Impersonated owner',
  })]), false);
  assert.equal(hasAuthorizedTestChangeApproval([event({ id: 112002218 })]), false);
});

test('fails closed for malformed and unrelated events', () => {
  const rejected = [
    event(),
    event({ id: '37439786' }),
    event({ id: 37439786.5 }),
    event({ id: 99999999 }),
    { ...event({ id: 37439786 }), event: 'unlabeled' },
    { ...event({ id: 37439786 }), label: { name: 'other-label' } },
    event({ id: 37439786, type: 'Bot' }),
  ];

  for (const candidate of rejected) {
    assert.equal(hasAuthorizedTestChangeApproval([candidate]), false);
  }
  assert.equal(hasAuthorizedTestChangeApproval(), false);
});

test('test-guard workflow invokes the shared approval predicate', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/test-guard.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /require\('\.\/\.github\/test-guard-approval\.cjs'\)/);
  assert.match(workflow, /return hasAuthorizedTestChangeApproval\(events\);/);
  assert.doesNotMatch(workflow, /e\.actor\?\.type === 'User'/);
});
