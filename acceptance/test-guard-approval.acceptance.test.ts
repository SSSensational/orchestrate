import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type IssueEvent = {
  event?: string;
  label?: { name?: string };
  actor?: {
    id?: unknown;
    type?: string;
    login?: string;
    name?: string;
  };
};

const require = createRequire(import.meta.url);
const { hasAuthorizedTestChangeApproval } = require('../.github/test-guard-approval.cjs') as {
  hasAuthorizedTestChangeApproval: (events: IssueEvent[]) => boolean;
};

const approvalEvent = (actor: IssueEvent['actor']): IssueEvent => ({
  event: 'labeled',
  label: { name: 'approved-test-change' },
  actor,
});

describe('test-guard human approval', () => {
  it('rejects a PAT bot label on a protected test change', () => {
    const events = [
      approvalEvent({ id: 112002218, type: 'User', login: 'uuiodwae' }),
    ];

    expect(hasAuthorizedTestChangeApproval(events)).toBe(false);
  });

  it('accepts the configured human CODEOWNER label', () => {
    const events = [
      approvalEvent({ id: 37439786, type: 'User', login: 'SSSensational' }),
    ];

    expect(hasAuthorizedTestChangeApproval(events)).toBe(true);
  });

  it('authorizes by durable ID regardless of login or display name', () => {
    const currentPresentation = approvalEvent({
      id: 37439786,
      type: 'User',
      login: 'SSSensational',
      name: 'Current display name',
    });
    const changedPresentation = approvalEvent({
      id: 37439786,
      type: 'User',
      login: 'renamed-owner',
    });

    expect(hasAuthorizedTestChangeApproval([currentPresentation])).toBe(true);
    expect(hasAuthorizedTestChangeApproval([changedPresentation])).toBe(true);
  });

  it.each([
    ['missing actor ID', approvalEvent({ type: 'User', login: 'SSSensational' })],
    [
      'non-integer actor ID',
      approvalEvent({ id: 37439786.5, type: 'User', login: 'SSSensational' }),
    ],
    [
      'non-numeric actor ID',
      approvalEvent({ id: '37439786', type: 'User', login: 'SSSensational' }),
    ],
    [
      'unlisted actor ID',
      approvalEvent({ id: 1, type: 'User', login: 'unlisted-human' }),
    ],
    [
      'unrelated event type',
      {
        ...approvalEvent({ id: 37439786, type: 'User', login: 'SSSensational' }),
        event: 'unlabeled',
      },
    ],
    [
      'unrelated label',
      {
        ...approvalEvent({ id: 37439786, type: 'User', login: 'SSSensational' }),
        label: { name: 'ready' },
      },
    ],
    [
      'non-User actor type',
      approvalEvent({ id: 37439786, type: 'Bot', login: 'SSSensational' }),
    ],
  ])('fails closed for %s', (_case, event) => {
    expect(hasAuthorizedTestChangeApproval([event])).toBe(false);
  });

  it('keeps the workflow on the documented shared policy entrypoint', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/test-guard.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('.github/test-guard-approval.cjs');
    expect(workflow).toContain('hasAuthorizedTestChangeApproval');
    expect(workflow).not.toMatch(/37439786|112002218|SSSensational|uuiodwae/);
  });
});
