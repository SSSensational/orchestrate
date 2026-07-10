import test from 'node:test';
import assert from 'node:assert/strict';
import { firstOpenIssueNumber } from './watch-order.mjs';

test('advances change tasks only after the prior issue closes', () => {
  const seededNewestFirst = [12, 11, 10, 9, 8, 7, 6].map((number) => ({ number }));

  assert.equal(firstOpenIssueNumber(seededNewestFirst), 6);
  assert.equal(firstOpenIssueNumber(seededNewestFirst.filter(({ number }) => number !== 6)), 7);
  assert.equal(firstOpenIssueNumber([]), null);
});
