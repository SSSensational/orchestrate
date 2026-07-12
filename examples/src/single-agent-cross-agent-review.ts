export const singleAgentCrossAgentReviewIr = {
  schema: 'agent.workflow/v1',
  name: 'Cross-Agent Review (Single Agent)',
  inputs: {
    target: {
      type: 'string',
      description: 'Repository path, pull request, or specification to review',
    },
  },
  workspace: {
    path: '{{inputs.target}}',
    mode: 'shared_readonly',
  },
  actor: {
    initiator: 'local-user',
  },
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
  nodes: [
    {
      id: 'codex_review',
      type: 'agent.run',
      agent: 'codex',
      prompt:
        'Review the target for correctness, implementation risks, and missing tests. Return a concise report.',
      output_artifacts: ['report'],
      required_capabilities: ['sandbox'],
    },
  ],
  edges: [],
} as const;

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
