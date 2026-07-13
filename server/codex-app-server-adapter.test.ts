import { readFileSync } from 'node:fs';

import type { AgentEvent, AgentResult } from '@agent-workflow/shared';
import { describe, expect, it } from 'vitest';

import {
  CODEX_APP_SERVER_SMOKE_PROMPT,
  normalizeCodexAppServerMessages,
} from './src/codex-app-server-adapter.js';

interface FixtureMetadata {
  recordType: 'metadata';
  source: string;
  codexVersion: string;
  prompt: string;
}

interface FixtureMessage {
  recordType: 'message';
  case: string;
  payload: unknown;
}

const fixtureUrl = new URL(
  './fixtures/codex-app-server-0.144.1.jsonl',
  import.meta.url,
);
const rawFixture = readFileSync(fixtureUrl, 'utf8');
const fixtureLines = rawFixture
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as FixtureMetadata | FixtureMessage);
const metadata = fixtureLines[0] as FixtureMetadata;
const messages = fixtureLines.slice(1) as FixtureMessage[];

const expectedByCase = new Map<
  string,
  { events: AgentEvent[]; result: AgentResult }
>([
  [
    'completed-smoke',
    {
      events: [
        { type: 'session', sessionId: 'session-recorded' },
        { type: 'text_delta', text: 'CODEX_APP_SERVER_SMOKE_OK' },
        { type: 'usage', inputTokens: 16_573, outputTokens: 11 },
      ],
      result: {
        status: 'completed',
        sessionId: 'session-recorded',
        finalText: 'CODEX_APP_SERVER_SMOKE_OK',
      },
    },
  ],
  [
    'unknown-notification',
    {
      events: [
        {
          type: 'raw',
          payload: {
            method: 'turn/started',
            params: {
              threadId: 'thread-recorded',
              turn: {
                id: 'turn-recorded',
                items: [],
                status: 'inProgress',
                error: null,
              },
            },
          },
        },
      ],
      result: {
        status: 'failed',
        failureReason:
          'Protocol ended before a terminal turn/completed notification.',
      },
    },
  ],
]);

const fixtureCases = [...new Set(messages.map((message) => message.case))].map(
  (name) => ({
    name,
    messages: messages
      .filter((message) => message.case === name)
      .map((message) => message.payload),
    expected: expectedByCase.get(name),
  }),
);

describe('recorded Codex app-server normalization', () => {
  it('records a versioned, sanitized real smoke fixture', () => {
    expect(metadata).toMatchObject({
      recordType: 'metadata',
      source: 'real local app-server smoke run',
      prompt: CODEX_APP_SERVER_SMOKE_PROMPT,
    });
    expect(metadata.codexVersion.trim()).not.toBe('');
    expect(rawFixture).not.toMatch(
      /(?:access[_-]?token|authorization|bearer\s+|https?:\/\/|\/Users\/|\/home\/|[A-Z]:\\Users\\)/i,
    );
    expect(rawFixture.match(/"prompt"/g)).toHaveLength(1);
    expect(fixtureCases).toHaveLength(expectedByCase.size);
    expect(fixtureCases.every(({ expected }) => expected !== undefined)).toBe(
      true,
    );
  });

  it.each(fixtureCases)('$name maps to exact events and result', (fixture) => {
    expect(normalizeCodexAppServerMessages(fixture.messages)).toEqual(
      fixture.expected,
    );
  });
});

describe('Codex app-server fail-closed normalization', () => {
  it('normalizes tool lifecycle items exactly', () => {
    expect(
      normalizeCodexAppServerMessages([
        {
          id: 2,
          result: {
            thread: { id: 'thread-recorded', sessionId: 'session-recorded' },
          },
        },
        {
          method: 'item/started',
          params: {
            item: {
              id: 'tool-recorded',
              type: 'commandExecution',
              status: 'inProgress',
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              id: 'tool-recorded',
              type: 'commandExecution',
              status: 'completed',
            },
          },
        },
        {
          method: 'turn/completed',
          params: { turn: { status: 'completed' } },
        },
      ]),
    ).toEqual({
      events: [
        { type: 'session', sessionId: 'session-recorded' },
        {
          type: 'tool_call',
          callId: 'tool-recorded',
          tool: 'commandExecution',
          status: 'running',
        },
        {
          type: 'tool_call',
          callId: 'tool-recorded',
          tool: 'commandExecution',
          status: 'completed',
        },
      ],
      result: { status: 'completed', sessionId: 'session-recorded' },
    });
  });

  it.each([
    {
      name: 'unsupported server request',
      message: {
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: {},
      },
      reason: 'Unsupported server request:',
    },
    {
      name: 'malformed delta',
      message: {
        method: 'item/agentMessage/delta',
        params: { delta: '' },
      },
      reason: 'Protocol error:',
    },
  ])('$name returns an explicit failure', ({ message, reason }) => {
    const normalized = normalizeCodexAppServerMessages([message]);

    expect(normalized.result.status).toBe('failed');
    expect(normalized.result.failureReason).toContain(reason);
    expect(normalized.result.failureReason?.trim()).not.toBe('');
  });
});
