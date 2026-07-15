import { describe, expect, it } from 'vitest';

import {
  codexAgentRegistry,
  singleAgentCrossAgentReviewIr,
} from '../examples/src/index.js';
import {
  type AgentCapabilities,
  type AgentRegistry,
  type WorkflowEdge,
  type WorkflowIr,
  type WorkflowNode,
  validateWorkflowIrL1,
  validateWorkflowIrL2,
} from './src/index.js';

const capabilities: AgentCapabilities = { ...codexAgentRegistry.codex };

function makeNode(
  id: string,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    ...(structuredClone(
      singleAgentCrossAgentReviewIr.nodes[0],
    ) as unknown as WorkflowNode),
    id,
    prompt: 'Run the node.',
    output_artifacts: [`${id}_artifact`],
    ...overrides,
  };
}

function makeIr(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowIr {
  return {
    ...(structuredClone(singleAgentCrossAgentReviewIr) as unknown as WorkflowIr),
    nodes,
    edges,
  };
}

describe('workflow IR validation hardening', () => {
  it('uses one identifier grammar for declarations and template references', () => {
    const valid = makeIr(
      [
        makeNode('producer_v2', { output_artifacts: ['report-v1'] }),
        makeNode('consumer-2', {
          prompt: 'Use {{nodes.producer_v2.artifacts.report-v1}}.',
        }),
      ],
      [{ from: 'producer_v2', to: 'consumer-2' }],
    );
    const l1 = validateWorkflowIrL1(valid);

    expect(l1.success).toBe(true);
    if (!l1.success) return;
    expect(validateWorkflowIrL2(l1.data, codexAgentRegistry).errors).toEqual([]);

    const invalid = [
      {
        ir: makeIr([
          makeNode('producer.v2', { output_artifacts: ['report'] }),
        ]),
        locator: { node: 'producer.v2', edge: null },
      },
      {
        ir: makeIr(
          [makeNode('producer'), makeNode('consumer')],
          [{ from: 'producer.v2', to: 'consumer' }],
        ),
        locator: {
          node: null,
          edge: { from: 'producer.v2', to: 'consumer' },
        },
      },
      {
        ir: makeIr([
          makeNode('producer', { output_artifacts: ['report.v1'] }),
        ]),
        locator: { node: 'producer', edge: null },
      },
    ];

    for (const { ir, locator } of invalid) {
      const first = validateWorkflowIrL1(ir);
      const second = validateWorkflowIrL1(ir);

      expect(second).toEqual(first);
      expect(first.success).toBe(false);
      expect(first.errors).toContainEqual(expect.objectContaining(locator));
    }
  });

  it('reports every malformed node-artifact candidate in prompt order', () => {
    const malformed = [
      '{{nodes.producer.v2.artifacts.report}}',
      '{{nodes.producer.artifacts.report.v1}}',
      '{{nodes.producer.artifacts.report',
    ];
    const ir = makeIr(
      [
        makeNode('producer', { output_artifacts: ['report'] }),
        makeNode('consumer', { prompt: malformed.join(' then ') }),
      ],
      [{ from: 'producer', to: 'consumer' }],
    );

    expect(validateWorkflowIrL2(ir, codexAgentRegistry).errors).toEqual(
      malformed.map((reference) => ({
        node: 'consumer',
        edge: null,
        code: 'l2.invalid_template_syntax',
        message: `Node "consumer" contains invalid template reference syntax "${reference}".`,
      })),
    );
  });

  it('requires an own registry property before reading capabilities', () => {
    const prototypeAgentIr = makeIr([
      makeNode('review', { agent: 'prototype-agent' }),
    ]);
    const inheritedRegistry = Object.create({
      'prototype-agent': capabilities,
    }) as AgentRegistry;

    for (const [ir, registry, agent] of [
      [makeIr([makeNode('review', { agent: 'toString' })]), {}, 'toString'],
      [prototypeAgentIr, inheritedRegistry, 'prototype-agent'],
    ] as const) {
      expect(validateWorkflowIrL2(ir, registry).errors).toEqual([
        {
          node: 'review',
          edge: null,
          code: 'l2.agent_not_found',
          message: `Agent "${agent}" referenced by node "review" is not registered.`,
        },
      ]);
    }

    const ownRegistry: AgentRegistry = { toString: capabilities };
    expect(
      validateWorkflowIrL2(
        makeIr([makeNode('review', { agent: 'toString' })]),
        ownRegistry,
      ).errors,
    ).toEqual([]);
  });

  it('reports reachable back edges but leaves disconnected cycles unreachable', () => {
    const cycle = makeIr(
      [makeNode('root'), makeNode('a'), makeNode('b')],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const selfLoop = makeIr(
      [makeNode('root'), makeNode('a')],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    );
    const disconnected = makeIr(
      [makeNode('root'), makeNode('orphan')],
      [{ from: 'orphan', to: 'orphan' }],
    );

    expect(validateWorkflowIrL2(cycle, codexAgentRegistry).errors).toEqual([
      {
        node: null,
        edge: { from: 'b', to: 'a' },
        code: 'l2.directed_cycle',
        message:
          'Edge "b" -> "a" closes a directed cycle, which is not supported in Phase 1.',
      },
    ]);
    expect(validateWorkflowIrL2(selfLoop, codexAgentRegistry).errors[0]).toEqual(
      expect.objectContaining({
        node: null,
        edge: { from: 'a', to: 'a' },
        code: 'l2.directed_cycle',
      }),
    );
    expect(validateWorkflowIrL2(disconnected, codexAgentRegistry).errors).toEqual([
      {
        node: 'orphan',
        edge: null,
        code: 'l2.unreachable_node',
        message: 'Node "orphan" is not reachable from any root node.',
      },
    ]);
  });

  it('keeps new multi-error results repeat-stable with the public shape', () => {
    const ir = makeIr(
      [
        makeNode('root'),
        makeNode('a', {
          agent: 'toString',
          prompt: '{{nodes.root.artifacts.report.v1}}',
        }),
      ],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    );
    const first = validateWorkflowIrL2(ir, codexAgentRegistry).errors;
    const second = validateWorkflowIrL2(ir, codexAgentRegistry).errors;

    expect(second).toEqual(first);
    expect(first.map(({ code }) => code)).toEqual([
      'l2.directed_cycle',
      'l2.invalid_template_syntax',
      'l2.agent_not_found',
    ]);
    for (const error of first) {
      expect(Object.keys(error).sort()).toEqual([
        'code',
        'edge',
        'message',
        'node',
      ]);
    }
  });
});
