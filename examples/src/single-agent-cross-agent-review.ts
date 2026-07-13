import { singleAgentCrossAgentReviewIr } from '@agent-workflow/server';

export { singleAgentCrossAgentReviewIr };

export const crossAgentReviewIr = singleAgentCrossAgentReviewIr;

export const codexAgentRegistry = {
  codex: {
    resume: true,
    fork: true,
    structuredOutput: true,
    mcp: true,
    sandbox: true,
    interactivePermission: true,
  },
} as const;
