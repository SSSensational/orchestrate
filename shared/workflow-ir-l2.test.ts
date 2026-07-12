import { describe, expect, it } from 'vitest';

import {
  codexAgentRegistry,
  singleAgentCrossAgentReviewIr,
} from '../examples/src/index.js';
import {
  type WorkflowIr,
  validateWorkflowIrL2,
  workflowValidationErrorSchema,
} from './src/index.js';

function validIr() {
  return structuredClone(singleAgentCrossAgentReviewIr) as WorkflowIr;
}

describe('workflow IR L2 validation', () => {
  it('accepts the bundled example with the Codex registry', () => {
    expect(validateWorkflowIrL2(singleAgentCrossAgentReviewIr, codexAgentRegistry))
      .toEqual({
        success: true,
        data: singleAgentCrossAgentReviewIr,
        errors: [],
      });
  });

  it('returns stable located errors for each Phase 1 graph semantic', () => {
    const invalid = validIr();
    invalid.nodes.push(
      { ...invalid.nodes[0]!, prompt: 'duplicate', output_artifacts: [] },
      {
        ...invalid.nodes[0]!,
        id: 'closed',
        prompt: '{{nodes.codex_review.artifacts.missing}}',
        output_artifacts: [],
        required_capabilities: ['fork'],
      },
    );
    invalid.edges.push(
      { from: 'codex_review', to: 'missing' },
      { from: 'closed', to: 'closed' },
    );
    const registry = {
      codex: { ...codexAgentRegistry.codex, fork: false },
    };

    const first = validateWorkflowIrL2(invalid, registry);
    const second = validateWorkflowIrL2(invalid, registry);

    expect(first).toEqual(second);
    expect(first.success).toBe(false);
    if (first.success) return;

    expect(first.errors.map(({ code }) => code)).toEqual([
      'l2.duplicate_node_id',
      'l2.edge_endpoint_missing',
      'l2.unreachable_node',
      'l2.unresolved_template_reference',
      'l2.missing_capability',
    ]);
    for (const error of first.errors) {
      expect(workflowValidationErrorSchema.parse(error)).toEqual(error);
      expect(error.node ?? error.edge).not.toBeNull();
    }
  });

  it('resolves artifacts declared by a transitively upstream node', () => {
    const ir = validIr();
    ir.nodes.push(
      {
        ...ir.nodes[0]!,
        id: 'middle',
        prompt: 'Continue the review.',
      },
      {
        ...ir.nodes[0]!,
        id: 'consumer',
        prompt: 'Use {{nodes.codex_review.artifacts.report}}.',
      },
    );
    ir.edges.push(
      { from: 'codex_review', to: 'middle' },
      { from: 'middle', to: 'consumer' },
    );

    expect(validateWorkflowIrL2(ir, codexAgentRegistry).errors).toEqual([]);
  });

  it('reports an unregistered agent on its node', () => {
    const ir = validIr();
    ir.nodes[0]!.agent = 'missing';

    expect(validateWorkflowIrL2(ir, codexAgentRegistry).errors).toEqual([
      {
        node: 'codex_review',
        edge: null,
        code: 'l2.agent_not_found',
        message:
          'Agent "missing" referenced by node "codex_review" is not registered.',
      },
    ]);
  });
});
