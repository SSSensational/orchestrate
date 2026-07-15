import { describe, expect, it } from 'vitest';

import { singleAgentCrossAgentReviewIr } from '../server/src/bundled-workflow.ts';
import {
  validateWorkflowIrL1,
  validateWorkflowIrL2,
  type AgentCapabilities,
  type AgentRegistry,
  type WorkflowEdge,
  type WorkflowIr,
  type WorkflowNode,
  type WorkflowValidationError,
} from '../shared/src/index.ts';

const fullCapabilities: AgentCapabilities = {
  resume: true,
  fork: true,
  structuredOutput: true,
  mcp: true,
  sandbox: true,
  interactivePermission: true,
};

const limitedCapabilities: AgentCapabilities = {
  ...fullCapabilities,
  mcp: false,
};

function node(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'agent.run',
    agent: 'codex',
    prompt: 'Complete the assigned workflow step.',
    output_artifacts: [],
    required_capabilities: [],
    ...overrides,
  };
}

function ir(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowIr {
  return {
    schema: 'agent.workflow/v1',
    name: 'workflow-ir #46 acceptance fixture',
    inputs: {},
    workspace: { path: '/tmp/workflow-ir-46', mode: 'shared_readonly' },
    actor: { initiator: 'acceptance-test' },
    policies: {
      max_rounds: 1,
      max_node_runs: 1,
      timeout_seconds: 0,
      default_permissions: {
        filesystem: 'read',
        commands: 'safe',
        network: false,
        mcp_servers: [],
      },
    },
    nodes,
    edges,
  };
}

function ownRegistry(...agents: string[]): AgentRegistry {
  return Object.fromEntries(agents.map((agent) => [agent, fullCapabilities]));
}

function stableErrors(run: () => { success: boolean; errors: WorkflowValidationError[] }) {
  const first = run();
  const second = run();

  expect(first.success).toBe(false);
  expect(first.errors.length).toBeGreaterThan(0);
  expect(second.success).toBe(false);
  expect(second.errors).toEqual(first.errors);

  return first.errors;
}

function errorAtNode(errors: WorkflowValidationError[], id: string, text: string) {
  return errors.find(
    (error) => error.node === id && error.edge === null && error.message.includes(text),
  );
}

describe('workflow-ir hardening', () => {
  it('#46 rejects Object.prototype agent names that are not own registry properties deterministically', () => {
    const workflow = ir([node('review', { agent: 'toString' })]);
    const registry: AgentRegistry = {};

    expect(Object.hasOwn(registry, 'toString')).toBe(false);
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, registry));
    const error = errorAtNode(errors, 'review', 'toString');

    expect(error).toBeDefined();
    expect(error?.code).toEqual(expect.any(String));
    expect(error?.code.length).toBeGreaterThan(0);
  });

  it('#46 rejects complete agent entries inherited from a custom registry prototype', () => {
    const workflow = ir([node('review', { agent: 'prototype-agent' })]);
    const registry = Object.create({ 'prototype-agent': fullCapabilities }) as AgentRegistry;

    expect(Object.hasOwn(registry, 'prototype-agent')).toBe(false);
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, registry));

    expect(errorAtNode(errors, 'review', 'prototype-agent')).toBeDefined();
  });

  it('#46 accepts an own satisfying registry entry whose name collides with Object.prototype', () => {
    const workflow = ir([node('review', { agent: 'toString', required_capabilities: ['sandbox'] })]);
    const registry = Object.defineProperty({}, 'toString', {
      value: fullCapabilities,
      enumerable: true,
    }) as AgentRegistry;

    expect(Object.hasOwn(registry, 'toString')).toBe(true);
    const first = validateWorkflowIrL2(workflow, registry);
    const second = validateWorkflowIrL2(workflow, registry);

    expect(first).toEqual({ success: true, data: workflow, errors: [] });
    expect(second).toEqual(first);
  });

  it('#46 accepts underscore and hyphen identifiers through L1 and L2 artifact resolution', () => {
    const workflow = ir(
      [
        node('producer_v2', { agent: 'producer-agent', output_artifacts: ['report-v1'] }),
        node('consumer-2', {
          agent: 'consumer_agent',
          prompt: '{{nodes.producer_v2.artifacts.report-v1}}',
        }),
      ],
      [{ from: 'producer_v2', to: 'consumer-2' }],
    );

    const l1 = validateWorkflowIrL1(workflow);
    expect(l1.success).toBe(true);
    expect(l1.errors).toEqual([]);
    if (!l1.success) throw new Error('expected #46 allowed identifiers to pass L1');

    expect(validateWorkflowIrL2(l1.data, ownRegistry('producer-agent', 'consumer_agent'))).toEqual({
      success: true,
      data: l1.data,
      errors: [],
    });
  });

  it.each([
    {
      label: 'node id',
      workflow: ir([node('producer.v2')]),
      locator: { node: 'producer.v2', edge: null },
    },
    {
      label: 'edge endpoint',
      workflow: ir(
        [node('producer'), node('consumer')],
        [{ from: 'producer.v2', to: 'consumer' }],
      ),
      locator: { node: null, edge: { from: 'producer.v2', to: 'consumer' } },
    },
    {
      label: 'artifact name',
      workflow: ir([node('producer', { output_artifacts: ['report.v1'] })]),
      locator: { node: 'producer', edge: null },
    },
  ])('#46 rejects a dotted declared $label at L1 with its exact locator', ({ workflow, locator }) => {
    const errors = stableErrors(() => validateWorkflowIrL1(workflow));

    expect(errors).toContainEqual(expect.objectContaining(locator));
  });

  it.each([
    '{{nodes.producer.v2.artifacts.report}}',
    '{{nodes.producer.artifacts.report.v1}}',
  ])('#46 rejects dotted template segments as L2 syntax errors: %s', (candidate) => {
    const workflow = ir(
      [
        node('producer', { output_artifacts: ['report'] }),
        node('consumer', { prompt: candidate }),
      ],
      [{ from: 'producer', to: 'consumer' }],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));

    expect(errorAtNode(errors, 'consumer', candidate)).toBeDefined();
  });

  it('#46 rejects an unterminated node-artifact candidate as an L2 syntax error', () => {
    const candidate = '{{nodes.producer.artifacts.report';
    const workflow = ir(
      [
        node('producer', { output_artifacts: ['report'] }),
        node('consumer', { prompt: `Use ${candidate}` }),
      ],
      [{ from: 'producer', to: 'consumer' }],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));

    expect(errorAtNode(errors, 'consumer', candidate)).toBeDefined();
  });

  it('#46 does not skip a well-formed unresolved artifact reference', () => {
    const candidate = '{{nodes.producer_v2.artifacts.missing-report}}';
    const workflow = ir(
      [
        node('producer_v2', { output_artifacts: ['report'] }),
        node('consumer', { prompt: candidate }),
      ],
      [{ from: 'producer_v2', to: 'consumer' }],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));
    const unresolved = errorAtNode(errors, 'consumer', candidate);

    expect(unresolved).toBeDefined();

    const malformed = '{{nodes.producer_v2.artifacts.missing.report}}';
    const malformedWorkflow = ir(
      [
        node('producer_v2', { output_artifacts: ['report'] }),
        node('consumer', { prompt: malformed }),
      ],
      [{ from: 'producer_v2', to: 'consumer' }],
    );
    const syntax = errorAtNode(
      stableErrors(() => validateWorkflowIrL2(malformedWorkflow, ownRegistry('codex'))),
      'consumer',
      malformed,
    );

    expect(syntax).toBeDefined();
    expect(unresolved?.code).not.toBe(syntax?.code);
  });

  it('#46 rejects root -> a -> b -> a with a stable exact cycle-edge locator', () => {
    const workflow = ir(
      [node('root'), node('a'), node('b')],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));
    const cycle = errors.find(
      (error) =>
        error.node === null &&
        error.edge?.from === 'b' &&
        error.edge.to === 'a',
    );

    expect(cycle).toBeDefined();
    expect(cycle?.code.length).toBeGreaterThan(0);
    expect(cycle?.message.length).toBeGreaterThan(0);
  });

  it('#46 rejects a reachable self-loop with the exact loop edge locator', () => {
    const workflow = ir(
      [node('root'), node('a')],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));

    expect(errors).toContainEqual(
      expect.objectContaining({
        node: null,
        edge: { from: 'a', to: 'a' },
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
    const cycle = errors.find((error) => error.edge?.from === 'a' && error.edge.to === 'a');
    expect(cycle?.code.length).toBeGreaterThan(0);
    expect(cycle?.message.length).toBeGreaterThan(0);
  });

  it('#46 keeps an isolated self-loop unreachable without adding a cycle error', () => {
    const reachableLoop = ir(
      [node('root'), node('a')],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    );
    const cycleCode = stableErrors(() =>
      validateWorkflowIrL2(reachableLoop, ownRegistry('codex')),
    ).find((error) => error.edge?.from === 'a' && error.edge.to === 'a')?.code;
    expect(cycleCode).toBeDefined();

    const isolatedLoop = ir(
      [node('root'), node('orphan')],
      [{ from: 'orphan', to: 'orphan' }],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(isolatedLoop, ownRegistry('codex')));

    expect(errors).toContainEqual(
      expect.objectContaining({ node: 'orphan', edge: null }),
    );
    expect(errors.some((error) => error.code === cycleCode)).toBe(false);
  });

  it('#46 keeps the bundled IR and transitive-upstream artifact behavior valid', () => {
    const bundledL1 = validateWorkflowIrL1(singleAgentCrossAgentReviewIr);
    expect(bundledL1.success).toBe(true);
    if (!bundledL1.success) throw new Error('expected the #46 bundled IR to pass L1');
    expect(validateWorkflowIrL2(bundledL1.data, ownRegistry('codex')).errors).toEqual([]);

    const transitive = ir(
      [
        node('producer', { output_artifacts: ['report'] }),
        node('middle'),
        node('consumer', { prompt: '{{nodes.producer.artifacts.report}}' }),
      ],
      [
        { from: 'producer', to: 'middle' },
        { from: 'middle', to: 'consumer' },
      ],
    );
    const transitiveL1 = validateWorkflowIrL1(transitive);
    expect(transitiveL1.success).toBe(true);
    if (!transitiveL1.success) throw new Error('expected the #46 transitive fixture to pass L1');
    expect(validateWorkflowIrL2(transitiveL1.data, ownRegistry('codex')).errors).toEqual([]);
  });

  it('#46 preserves the mixed builder fixture five-category error order', () => {
    const unresolved = '{{nodes.start.artifacts.missing-report}}';
    const workflow = ir(
      [
        node('start', { output_artifacts: ['report'] }),
        node('start'),
        node('consumer', { prompt: unresolved }),
        node('orphan'),
        node('capability', { agent: 'limited', required_capabilities: ['mcp'] }),
      ],
      [
        { from: 'start', to: 'consumer' },
        { from: 'start', to: 'capability' },
        { from: 'missing', to: 'consumer' },
        { from: 'orphan', to: 'orphan' },
      ],
    );
    const registry = { codex: fullCapabilities, limited: limitedCapabilities };
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, registry));

    expect(errors.map(({ node: errorNode, edge }) => ({ node: errorNode, edge }))).toEqual([
      { node: 'start', edge: null },
      { node: null, edge: { from: 'missing', to: 'consumer' } },
      { node: 'orphan', edge: null },
      { node: 'consumer', edge: null },
      { node: 'capability', edge: null },
    ]);
    expect(new Set(errors.map((error) => error.code)).size).toBe(5);
    expect(errors[0]?.message).toContain('start');
    expect(errors[1]?.message).toContain('missing');
    expect(errors[3]?.message).toContain(unresolved);
    expect(errors[4]?.message).toContain('mcp');

    const reachableLoop = ir(
      [node('root'), node('loop')],
      [
        { from: 'root', to: 'loop' },
        { from: 'loop', to: 'loop' },
      ],
    );
    const cycleCode = stableErrors(() =>
      validateWorkflowIrL2(reachableLoop, ownRegistry('codex')),
    ).find((error) => error.edge?.from === 'loop' && error.edge.to === 'loop')?.code;
    expect(errors.some((error) => error.code === cycleCode)).toBe(false);
  });

  it('#46 keeps new multi-error diagnostics deterministic, public-shaped, and category-distinct', () => {
    const malformed = '{{nodes.a.artifacts.report.extra}}';
    const workflow = ir(
      [
        node('root', { agent: 'toString', prompt: malformed }),
        node('a', { output_artifacts: ['report'] }),
        node('b'),
      ],
      [
        { from: 'root', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const errors = stableErrors(() => validateWorkflowIrL2(workflow, ownRegistry('codex')));

    for (const error of errors) {
      expect(Object.keys(error).sort()).toEqual(['code', 'edge', 'message', 'node']);
      expect(error.code.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }

    const cycle = errors.find(
      (error) => error.node === null && error.edge?.from === 'b' && error.edge.to === 'a',
    );
    const syntax = errorAtNode(errors, 'root', malformed);
    const unregistered = errorAtNode(errors, 'root', 'toString');

    expect(cycle).toBeDefined();
    expect(syntax).toBeDefined();
    expect(unregistered).toBeDefined();
    expect(new Set([cycle?.code, syntax?.code, unregistered?.code]).size).toBe(3);
  });
});
