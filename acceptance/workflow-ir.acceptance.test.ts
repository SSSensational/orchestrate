import { describe, expect, it } from 'vitest';

import {
  validateWorkflowIrL1,
  validateWorkflowIrL2,
} from '../shared/src/index.js';
import type {
  AgentRegistry,
  WorkflowEdge,
  WorkflowIr,
  WorkflowNode,
  WorkflowValidationError,
} from '../shared/src/index.js';
import {
  codexAgentRegistry,
  singleAgentCrossAgentReviewIr,
} from '../examples/src/index.js';

const PUBLIC_ERROR_KEYS = ['code', 'edge', 'message', 'node'];

function cloneBundledIr(): WorkflowIr {
  // ponytail: structuredClone removes readonly at runtime; this cast tells TS that fact.
  return structuredClone(singleAgentCrossAgentReviewIr) as unknown as WorkflowIr;
}

function makeNode(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    ...cloneBundledIr().nodes[0]!,
    id,
    output_artifacts: [`${id}_artifact`],
    ...overrides,
  };
}

function makeIr(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowIr {
  return {
    ...cloneBundledIr(),
    nodes,
    edges,
  };
}

function expectPublicErrorShape(errors: WorkflowValidationError[]): void {
  for (const error of errors) {
    expect(Object.keys(error).sort()).toEqual(PUBLIC_ERROR_KEYS);
    expect(error.code.trim()).not.toBe('');
    expect(error.message.trim()).not.toBe('');
  }
}

function expectStableL2Error(
  ir: WorkflowIr,
  registry: AgentRegistry,
  locate: (error: WorkflowValidationError) => boolean,
): WorkflowValidationError {
  const first = validateWorkflowIrL2(ir, registry);
  const second = validateWorkflowIrL2(ir, registry);

  expect(first.success).toBe(false);
  expect(first.errors.length).toBeGreaterThan(0);
  expect(second.errors).toStrictEqual(first.errors);
  expectPublicErrorShape(first.errors);

  const error = first.errors.find(locate);
  expect(error).toBeDefined();
  expect(error!.code.trim()).not.toBe('');
  return error!;
}

const duplicateId = 'duplicate';
const danglingEdge = { from: 'codex_review', to: 'missing-node' };
const unreachableId = 'unreachable';
const unresolvedReference = '{{nodes.producer.artifacts.missing_report}}';
const missingAgent = 'missing-agent';
const missingCapability = 'fork';

const l2Failures = {
  duplicate: {
    ir: makeIr([makeNode(duplicateId), makeNode(duplicateId)]),
    registry: codexAgentRegistry,
    locate: (error: WorkflowValidationError) => error.node === duplicateId,
  },
  dangling: {
    ir: makeIr([makeNode('codex_review')], [danglingEdge]),
    registry: codexAgentRegistry,
    locate: (error: WorkflowValidationError) =>
      JSON.stringify(error.edge) === JSON.stringify(danglingEdge),
  },
  unreachable: {
    ir: makeIr(
      [makeNode('root'), makeNode(unreachableId)],
      [{ from: unreachableId, to: unreachableId }],
    ),
    registry: codexAgentRegistry,
    locate: (error: WorkflowValidationError) => error.node === unreachableId,
  },
  unresolvedTemplate: {
    ir: makeIr(
      [
        makeNode('producer', { output_artifacts: ['report'] }),
        makeNode('consumer', { prompt: `Use ${unresolvedReference}` }),
      ],
      [{ from: 'producer', to: 'consumer' }],
    ),
    registry: codexAgentRegistry,
    locate: (error: WorkflowValidationError) =>
      error.node === 'consumer' && error.message.includes(unresolvedReference),
  },
  missingAgent: {
    ir: makeIr([makeNode('missing_agent', { agent: missingAgent })]),
    registry: codexAgentRegistry,
    locate: (error: WorkflowValidationError) =>
      error.node === 'missing_agent' && error.message.includes(missingAgent),
  },
  missingCapability: {
    ir: makeIr([
      makeNode('needs_fork', { required_capabilities: [missingCapability] }),
    ]),
    registry: {
      codex: { ...codexAgentRegistry.codex, [missingCapability]: false },
    },
    locate: (error: WorkflowValidationError) =>
      error.node === 'needs_fork' && error.message.includes(missingCapability),
  },
} satisfies Record<
  string,
  {
    ir: WorkflowIr;
    registry: AgentRegistry;
    locate: (error: WorkflowValidationError) => boolean;
  }
>;

describe('workflow-ir M2/M3 acceptance', () => {
  it('#24 bundled example passes L1 without coercion', () => {
    const input = structuredClone(singleAgentCrossAgentReviewIr);
    const result = validateWorkflowIrL1(input);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data).toStrictEqual(input);
  });

  it('#24 rejects an unknown agent-node field with the public error contract', () => {
    const input = structuredClone(singleAgentCrossAgentReviewIr);
    const nodeId = input.nodes[0].id;
    const invalidInput = {
      ...input,
      nodes: [{ ...input.nodes[0], unknown_field: true }],
    };
    const result = validateWorkflowIrL1(invalidInput);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expectPublicErrorShape(result.errors);

    const error = result.errors.find((candidate) => candidate.node === nodeId);
    expect(error).toBeDefined();
    expect(error!.edge).toBeNull();
    expect(error!.code.trim()).not.toBe('');
    expect(error!.message.trim()).not.toBe('');
  });

  it('#25 bundled example and capable Codex registry pass L2', () => {
    const result = validateWorkflowIrL2(
      structuredClone(singleAgentCrossAgentReviewIr),
      structuredClone(codexAgentRegistry),
    );

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('#25 accepts a transitively upstream producer artifact reference', () => {
    const ir = makeIr(
      [
        makeNode('producer', { output_artifacts: ['report'] }),
        makeNode('relay', { output_artifacts: ['relay_report'] }),
        makeNode('consumer', {
          prompt: 'Use {{nodes.producer.artifacts.report}}',
          output_artifacts: ['final_report'],
        }),
      ],
      [
        { from: 'producer', to: 'relay' },
        { from: 'relay', to: 'consumer' },
      ],
    );

    const result = validateWorkflowIrL2(ir, codexAgentRegistry);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('#25 reports a duplicate id with a stable code and node locator', () => {
    const error = expectStableL2Error(
      l2Failures.duplicate.ir,
      l2Failures.duplicate.registry,
      l2Failures.duplicate.locate,
    );

    expect(error.node).toBe(duplicateId);
    expect(error.edge).toBeNull();
  });

  it('#25 reports a dangling edge with a stable code and exact edge locator', () => {
    const error = expectStableL2Error(
      l2Failures.dangling.ir,
      l2Failures.dangling.registry,
      l2Failures.dangling.locate,
    );

    expect(error.node).toBeNull();
    expect(error.edge).toStrictEqual(danglingEdge);
  });

  it('#25 reports an unreachable node with a stable code and node locator', () => {
    const error = expectStableL2Error(
      l2Failures.unreachable.ir,
      l2Failures.unreachable.registry,
      l2Failures.unreachable.locate,
    );

    expect(error.node).toBe(unreachableId);
    expect(error.edge).toBeNull();
  });

  it('#25 reports an unresolved template with its exact offending value', () => {
    const error = expectStableL2Error(
      l2Failures.unresolvedTemplate.ir,
      l2Failures.unresolvedTemplate.registry,
      l2Failures.unresolvedTemplate.locate,
    );

    expect(error.node).toBe('consumer');
    expect(error.edge).toBeNull();
    expect(error.message).toContain(unresolvedReference);
  });

  it('#25 reports a missing agent with its exact offending value', () => {
    const error = expectStableL2Error(
      l2Failures.missingAgent.ir,
      l2Failures.missingAgent.registry,
      l2Failures.missingAgent.locate,
    );

    expect(error.node).toBe('missing_agent');
    expect(error.edge).toBeNull();
    expect(error.message).toContain(missingAgent);
  });

  it('#25 reports a disabled legal capability with its exact offending value', () => {
    const error = expectStableL2Error(
      l2Failures.missingCapability.ir,
      l2Failures.missingCapability.registry,
      l2Failures.missingCapability.locate,
    );

    expect(error.node).toBe('needs_fork');
    expect(error.edge).toBeNull();
    expect(error.message).toContain(missingCapability);
  });

  it('#25 assigns six distinct stable failure categories without spelling codes', () => {
    const codes = Object.values(l2Failures).map((fixture) =>
      expectStableL2Error(fixture.ir, fixture.registry, fixture.locate).code,
    );

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('#25 returns the same ordered list for a repeatable multi-error input', () => {
    const ir = makeIr(
      [makeNode('invalid', { agent: missingAgent })],
      [{ from: 'invalid', to: 'missing-node' }],
    );

    const first = validateWorkflowIrL2(ir, codexAgentRegistry).errors;
    const second = validateWorkflowIrL2(ir, codexAgentRegistry).errors;

    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(second).toStrictEqual(first);
  });
});
