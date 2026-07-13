import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startServerChild,
  stopServerChild,
  type RunningServerChild,
} from './server-process.js';
import { windowOptions } from './window-options.js';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const rendererRoot = join(desktopRoot, '../web/dist/index.html');
const realServerEntry = join(desktopRoot, '../server/dist/runtime-server.js');
const fixtureServerEntry = join(
  desktopRoot,
  '../server/dist/runtime-server-fixture.js',
);
const smoke = process.argv.includes('--smoke');
let mainWindow: BrowserWindow | null = null;
let server: RunningServerChild | undefined;
let shutdownStarted = false;
let shutdownComplete = false;

async function smokeRenderer(window: BrowserWindow): Promise<void> {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (condition, label, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + label);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await waitFor(() => document.querySelector('#app')?.dataset.ready === 'true', 'renderer ready');
    const requests = [];
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      const init = args[1] ?? {};
      requests.push({ url: String(args[0]), method: String(init.method ?? 'GET').toUpperCase() });
      return originalFetch(...args);
    };
    document.querySelector('[data-testid="run-button"]')?.click();
    await waitFor(() => document.querySelector('.workflow-node')?.dataset.status === 'running', 'running node');
    const runningToken = document.querySelector('.workflow-node')?.dataset.colorToken;
    await waitFor(() => document.querySelector('[data-testid="agent-text"]')?.textContent?.includes('fixture delta one') === true, 'first live delta');
    const fingerprint = document.querySelector('main')?.dataset.irFingerprint;
    const node = document.querySelector('.react-flow__node');
    const transform = node?.style.transform;
    node?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 140, clientY: 140, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 260, clientY: 260, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 260, clientY: 260, pointerId: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    window.dispatchEvent(new CustomEvent('run-ui:test-disconnect', { detail: { delayMs: 900 } }));
    await waitFor(() => document.querySelector('.workflow-node')?.dataset.status === 'completed', 'completed node');
    await waitFor(() => document.querySelector('[data-artifact-id]') !== null, 'report artifact');
    const text = document.querySelector('[data-testid="agent-text"]')?.textContent ?? '';
    const artifact = document.querySelector('[data-artifact-id]');
    const details = [...(artifact?.querySelectorAll('dd') ?? [])].map((item) => item.textContent ?? '');
    return {
      ready: document.querySelector('#app')?.dataset.ready,
      requireType: typeof require,
      processType: typeof process,
      electronApiType: typeof window.electronAPI,
      runningToken,
      completedToken: document.querySelector('.workflow-node')?.dataset.colorToken,
      nodeStatus: document.querySelector('.workflow-node')?.dataset.status,
      nodeCount: document.querySelectorAll('.react-flow__node').length,
      fingerprintStable: fingerprint === document.querySelector('main')?.dataset.irFingerprint,
      positionStable: transform === document.querySelector('.react-flow__node')?.style.transform,
      firstDeltaCount: text.split('fixture delta one').length - 1,
      secondDeltaCount: text.split('fixture delta two').length - 1,
      reportComplete: artifact?.querySelector('.report-text')?.textContent?.includes('Second line.') === true,
      artifactId: artifact?.dataset.artifactId,
      artifactDetails: details,
      mutationRequests: requests.filter(({ method }) => ['PUT', 'PATCH', 'DELETE'].includes(method)),
      buttonLabels: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    };
  })()` ) as {
    ready?: string;
    requireType: string;
    processType: string;
    electronApiType: string;
    runningToken?: string;
    completedToken?: string;
    nodeStatus?: string;
    nodeCount: number;
    fingerprintStable: boolean;
    positionStable: boolean;
    firstDeltaCount: number;
    secondDeltaCount: number;
    reportComplete: boolean;
    artifactId?: string;
    artifactDetails: string[];
    mutationRequests: unknown[];
    buttonLabels: string[];
  };

  const passed = BrowserWindow.getAllWindows().length === 1
    && result.ready === 'true'
    && result.requireType === 'undefined'
    && result.processType === 'undefined'
    && result.electronApiType === 'undefined'
    && result.runningToken === 'status-running'
    && result.completedToken === 'status-completed'
    && result.nodeStatus === 'completed'
    && result.nodeCount === 1
    && result.fingerprintStable
    && result.positionStable
    && result.firstDeltaCount === 1
    && result.secondDeltaCount === 1
    && result.reportComplete
    && result.artifactId !== undefined
    && result.artifactDetails.every((value) => value.length > 0 && value !== '—')
    && result.mutationRequests.length === 0
    && result.buttonLabels.join(',') === 'Run';

  if (!passed) throw new Error(`Desktop E2E failed: ${JSON.stringify(result)}`);
  console.log(
    `Desktop E2E passed: ${JSON.stringify({
      appServerMode: 'fixture',
      childPid: server?.child.pid,
      origin: server === undefined
        ? undefined
        : `http://${server.readiness.host}:${server.readiness.port}`,
      artifactId: result.artifactId,
      reconnectDeltas: result.firstDeltaCount + result.secondDeltaCount,
    })}`,
  );
}

async function createWindow(): Promise<void> {
  const configuredEntry = process.env.AGENT_WORKFLOW_SERVER_ENTRY;
  const entry = configuredEntry ?? (smoke ? fixtureServerEntry : realServerEntry);
  const mode = configuredEntry === undefined ? (smoke ? 'fixture' : 'real') : 'custom';
  const databasePath = smoke
    ? undefined
    : process.env.AGENT_WORKFLOW_DB_PATH ?? join(app.getPath('userData'), 'runtime.sqlite');
  server = await startServerChild({
    entry,
    mode,
    env: databasePath === undefined ? {} : { AGENT_WORKFLOW_DB_PATH: databasePath },
  });

  const origin = `http://${server.readiness.host}:${server.readiness.port}`;
  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  await mainWindow.loadFile(rendererRoot, {
    query: {
      server_origin: origin,
      ...(smoke ? { e2e: 'true' } : {}),
    },
  });

  if (!smoke) return;
  await smokeRenderer(mainWindow);
  mainWindow.close();
}

app.on('before-quit', (event) => {
  if (server === undefined || shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void stopServerChild(server.child).then(
    () => {
      shutdownComplete = true;
      app.quit();
    },
    (error: unknown) => {
      console.error(error);
      shutdownComplete = true;
      app.exit(1);
    },
  );
});

app.whenReady().then(createWindow).catch(async (error: unknown) => {
  console.error(error);
  if (server !== undefined) await stopServerChild(server.child).catch(console.error);
  shutdownComplete = true;
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
