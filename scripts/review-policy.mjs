export const REVIEW_CHANGES_EXIT = 2;

export function selectReviewer({ override, labeled, builtBy, agents }) {
  return override || labeled || agents.find((agent) => agent !== builtBy) || agents[0];
}

export function reviewStep(exitCode, revisionRound) {
  if (exitCode === 0) return 'pass';
  if (exitCode === REVIEW_CHANGES_EXIT) return revisionRound === 0 ? 'revise' : 'changes';
  return 'failed';
}

export function parseReviewVerdict(text) {
  if (/VERDICT:\s*PASS/i.test(text)) return 'pass';
  if (/VERDICT:\s*CHANGES/i.test(text)) return 'changes';
  return null;
}

export function latestChangesFeedback(comments) {
  return [...comments].reverse().find(({ body }) =>
    body.startsWith('**顾问评审 ·') && /VERDICT:\s*CHANGES/i.test(body))?.body || null;
}
