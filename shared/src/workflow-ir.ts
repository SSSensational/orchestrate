import { z } from 'zod';

const inputSchema = z.strictObject({
  type: z.literal('string'),
  description: z.string().min(1).optional(),
});

const permissionsSchema = z.strictObject({
  filesystem: z.enum(['read', 'write']),
  commands: z.enum(['none', 'safe', 'all']),
  network: z.boolean(),
  mcp_servers: z.array(z.string().min(1)),
});

export const agentCapabilitySchema = z.enum([
  'resume',
  'fork',
  'structuredOutput',
  'mcp',
  'sandbox',
  'interactivePermission',
]);

export const agentCapabilitiesSchema = z.strictObject({
  resume: z.boolean(),
  fork: z.boolean(),
  structuredOutput: z.boolean(),
  mcp: z.boolean(),
  sandbox: z.boolean(),
  interactivePermission: z.boolean(),
});

export const workflowNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('agent.run'),
  agent: z.string().min(1),
  prompt: z.string().min(1),
  output_artifacts: z.array(z.string().min(1)),
  required_capabilities: z.array(agentCapabilitySchema).optional(),
});

export const workflowEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.string().min(1).optional(),
});

export const workflowIrSchema = z.strictObject({
  schema: z.literal('agent.workflow/v1'),
  name: z.string().min(1),
  inputs: z.record(z.string().min(1), inputSchema),
  workspace: z.strictObject({
    path: z.string().min(1),
    mode: z.enum(['shared_readonly', 'isolated_worktree']),
  }),
  actor: z.strictObject({
    initiator: z.string().min(1),
  }),
  policies: z.strictObject({
    max_rounds: z.number().int().positive(),
    max_node_runs: z.number().int().positive(),
    timeout_seconds: z.number().int().nonnegative(),
    default_permissions: permissionsSchema,
  }),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowIr = z.infer<typeof workflowIrSchema>;
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;
export type AgentRegistry = Readonly<Record<string, AgentCapabilities>>;

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type WorkflowIrL2Input = DeepReadonly<WorkflowIr>;

export const workflowValidationErrorSchema = z.strictObject({
  node: z.string().min(1).nullable(),
  edge: z
    .strictObject({ from: z.string().min(1), to: z.string().min(1) })
    .nullable(),
  code: z.string().min(1),
  message: z.string().min(1),
});

export type WorkflowValidationError = z.infer<
  typeof workflowValidationErrorSchema
>;

export type L1ValidationResult =
  | { success: true; data: WorkflowIr; errors: [] }
  | { success: false; data: null; errors: WorkflowValidationError[] };

export type L2ValidationResult<
  Ir extends WorkflowIrL2Input = WorkflowIr,
> =
  | { success: true; data: Ir; errors: [] }
  | { success: false; data: null; errors: WorkflowValidationError[] };

function objectAt(input: unknown, key: 'nodes' | 'edges', index: number) {
  if (typeof input !== 'object' || input === null) return undefined;
  const collection = (input as Record<string, unknown>)[key];
  if (!Array.isArray(collection)) return undefined;
  const value: unknown = collection[index];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function locateIssue(input: unknown, path: PropertyKey[]) {
  const nodePath = path[0] === 'nodes' && typeof path[1] === 'number';
  const edgePath = path[0] === 'edges' && typeof path[1] === 'number';
  const node = nodePath ? objectAt(input, 'nodes', path[1] as number) : undefined;
  const edge = edgePath ? objectAt(input, 'edges', path[1] as number) : undefined;

  return {
    node: typeof node?.id === 'string' && node.id.length > 0 ? node.id : null,
    edge:
      typeof edge?.from === 'string' &&
      edge.from.length > 0 &&
      typeof edge.to === 'string' &&
      edge.to.length > 0
        ? { from: edge.from, to: edge.to }
        : null,
  };
}

export function validateWorkflowIrL1(input: unknown): L1ValidationResult {
  const result = workflowIrSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: [] };

  return {
    success: false,
    data: null,
    errors: result.error.issues.map((issue) => ({
      ...locateIssue(input, issue.path),
      code: `l1.${issue.code}`,
      message: issue.message,
    })),
  };
}

const artifactReferencePattern =
  /{{nodes\.([^{}.]+)\.artifacts\.([^{}.]+)}}/g;

function nodeError(
  node: string,
  code: string,
  message: string,
): WorkflowValidationError {
  return { node, edge: null, code, message };
}

function upstreamNodeIds(
  nodeId: string,
  incoming: ReadonlyMap<string, readonly string[]>,
) {
  const upstream = new Set<string>();
  const pending = [...(incoming.get(nodeId) ?? [])];

  for (const id of pending) {
    if (upstream.has(id)) continue;
    upstream.add(id);
    pending.push(...(incoming.get(id) ?? []));
  }

  upstream.delete(nodeId);
  return upstream;
}

export function validateWorkflowIrL2<Ir extends WorkflowIrL2Input>(
  ir: Ir,
  registry: AgentRegistry,
): L2ValidationResult<Ir> {
  const errors: WorkflowValidationError[] = [];
  const nodesById = new Map<string, Ir['nodes'][number]>();

  for (const node of ir.nodes) {
    if (nodesById.has(node.id)) {
      errors.push(
        nodeError(
          node.id,
          'l2.duplicate_node_id',
          `Node id "${node.id}" is duplicated.`,
        ),
      );
    } else {
      nodesById.set(node.id, node);
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const indegree = new Map([...nodesById.keys()].map((id) => [id, 0]));

  for (const edge of ir.edges) {
    const missing = [edge.from, edge.to].filter((id) => !nodesById.has(id));
    if (missing.length > 0) {
      errors.push({
        node: null,
        edge: { from: edge.from, to: edge.to },
        code: 'l2.edge_endpoint_missing',
        message: `Edge "${edge.from}" -> "${edge.to}" references missing node(s): ${missing.join(', ')}.`,
      });
      continue;
    }

    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const reachable = new Set<string>();
  const pending = ir.nodes
    .map(({ id }) => id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .filter((id) => indegree.get(id) === 0);

  for (const id of pending) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }

  for (const node of ir.nodes) {
    if (!reachable.has(node.id)) {
      errors.push(
        nodeError(
          node.id,
          'l2.unreachable_node',
          `Node "${node.id}" is not reachable from any root node.`,
        ),
      );
    }
  }

  for (const node of ir.nodes) {
    const upstream = upstreamNodeIds(node.id, incoming);

    for (const match of node.prompt.matchAll(artifactReferencePattern)) {
      const reference = match[0];
      const producerId = match[1]!;
      const artifact = match[2]!;
      const producer = nodesById.get(producerId);

      if (
        !producer ||
        !upstream.has(producerId) ||
        !producer.output_artifacts.includes(artifact)
      ) {
        errors.push(
          nodeError(
            node.id,
            'l2.unresolved_template_reference',
            `Node "${node.id}" cannot resolve template reference "${reference}" to an upstream output artifact.`,
          ),
        );
      }
    }
  }

  for (const node of ir.nodes) {
    const capabilities = registry[node.agent];
    if (!capabilities) {
      errors.push(
        nodeError(
          node.id,
          'l2.agent_not_found',
          `Agent "${node.agent}" referenced by node "${node.id}" is not registered.`,
        ),
      );
      continue;
    }

    for (const capability of node.required_capabilities ?? []) {
      if (!capabilities[capability]) {
        errors.push(
          nodeError(
            node.id,
            'l2.missing_capability',
            `Agent "${node.agent}" is missing capability "${capability}" required by node "${node.id}".`,
          ),
        );
      }
    }
  }

  return errors.length === 0
    ? { success: true, data: ir, errors: [] }
    : { success: false, data: null, errors };
}
