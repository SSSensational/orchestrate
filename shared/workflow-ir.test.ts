import { describe, expect, it } from 'vitest';

import { singleAgentCrossAgentReviewIr } from '../examples/src/index.js';
import {
  validateWorkflowIrL1,
  workflowValidationErrorSchema,
} from './src/index.js';

describe('workflow IR L1 validation', () => {
  it('accepts the bundled example without changing it', () => {
    const result = validateWorkflowIrL1(singleAgentCrossAgentReviewIr);

    expect(result).toEqual({
      success: true,
      data: singleAgentCrossAgentReviewIr,
      errors: [],
    });
  });

  it('rejects an unknown node field with a stable public error', () => {
    const invalid = structuredClone(singleAgentCrossAgentReviewIr) as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    invalid.nodes[0]!.unexpected = true;

    const first = validateWorkflowIrL1(invalid);
    const second = validateWorkflowIrL1(invalid);

    expect(first).toEqual(second);
    expect(first.success).toBe(false);
    if (first.success) return;
    expect(first.errors[0]).toEqual({
      node: 'codex_review',
      edge: null,
      code: 'l1.unrecognized_keys',
      message: 'Unrecognized key: "unexpected"',
    });
    expect(workflowValidationErrorSchema.parse(first.errors[0])).toEqual(
      first.errors[0],
    );
  });
});
