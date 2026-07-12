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

export const workflowNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('agent.run'),
  agent: z.string().min(1),
  prompt: z.string().min(1),
  output_artifacts: z.array(z.string().min(1)),
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
