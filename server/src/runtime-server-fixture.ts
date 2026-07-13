import type {
  AgentAdapter,
  AgentCapabilities,
  AgentExecuteInput,
  AgentExecution,
} from '@agent-workflow/shared';

import { runServerProcess } from './runtime-server.js';

const capabilities: AgentCapabilities = {
  resume: true,
  fork: true,
  structuredOutput: true,
  mcp: true,
  sandbox: true,
  interactivePermission: true,
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const fixtureAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Deterministic Electron E2E fixture',
  capabilities: () => Promise.resolve(capabilities),
  probe: () => Promise.resolve({ available: true, version: 'fixture' }),
  execute(input: AgentExecuteInput): AgentExecution {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      events: (async function* () {
        try {
          yield { type: 'session' as const, sessionId: 'fixture-session' };
          yield { type: 'text_delta' as const, text: 'fixture delta one\n' };
          await delay(650);
          yield { type: 'text_delta' as const, text: 'fixture delta two\n' };
          await delay(650);
        } finally {
          finish();
        }
      })(),
      result: finished.then(() => ({
        status: 'completed' as const,
        sessionId: 'fixture-session',
        finalText: `Fixture final report for ${input.workspace.path}.\nSecond line.`,
      })),
    };
  },
  stop: () => Promise.resolve(),
};

process.stderr.write('[app-server] mode=fixture adapter=deterministic-electron-e2e\n');
void runServerProcess({
  adapters: { codex: fixtureAdapter },
  eventPollIntervalMs: 10,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
