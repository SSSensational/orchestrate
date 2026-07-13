import type { AgentCapabilities } from './workflow-ir.js';

export interface PermissionPolicy {
  filesystem: 'read' | 'write';
  commands: 'none' | 'safe' | 'all';
  network: boolean;
  mcp_servers: string[];
}

export interface Workspace {
  path: string;
  mode: 'shared_readonly' | 'isolated_worktree';
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | {
      type: 'tool_call';
      callId: string;
      tool: string;
      status: 'running' | 'completed' | 'failed';
      input?: unknown;
      output?: unknown;
    }
  | {
      type: 'permission_request';
      requestId: string;
      description: string;
      options: Array<{
        id: string;
        kind:
          | 'allow_once'
          | 'allow_always'
          | 'reject_once'
          | 'reject_always';
        label: string;
      }>;
    }
  | { type: 'artifact'; artifact: unknown }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    }
  | { type: 'raw'; payload: unknown };

export interface AgentResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  sessionId?: string;
  finalText?: string;
  structuredOutput?: unknown;
  failureReason?: string;
}

export interface AgentExecuteInput {
  taskId: string;
  prompt: string;
  workspace: Workspace;
  permissions: PermissionPolicy;
  mcpConfig: McpServerConfig[];
  outputSchema?: object;
  sessionId?: string;
  timeoutSeconds?: number;
}

export interface AgentExecution {
  events: AsyncIterable<AgentEvent>;
  result: Promise<AgentResult>;
}

export interface AgentAdapter {
  id: string;
  displayName: string;
  capabilities(): Promise<AgentCapabilities>;
  probe(): Promise<{ available: boolean; version?: string }>;
  execute(input: AgentExecuteInput): AgentExecution;
  respondPermission?(
    taskId: string,
    requestId: string,
    optionId: string,
  ): Promise<void>;
  stop(taskId: string): Promise<void>;
}
