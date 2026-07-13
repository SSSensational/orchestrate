import { afterEach, describe, expect, it } from 'vitest';

import { createRunApi } from './src/run-api.js';
import { RunOrchestrator } from './src/run-orchestrator.js';
import { RunStore } from './src/run-store.js';

describe('browser renderer API access', () => {
  const stores: RunStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('allows file and loopback browser origins but not remote sites', async () => {
    const store = new RunStore();
    stores.push(store);
    const app = createRunApi({
      store,
      orchestrator: new RunOrchestrator(store, {}),
    });

    for (const origin of ['null', 'http://127.0.0.1:5173']) {
      const response = await app.request('/api/runs', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    }

    const remote = await app.request('/api/runs', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(remote.headers.has('access-control-allow-origin')).toBe(false);
  });
});
