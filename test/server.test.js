import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerApp } from '../src/server.js';

test('creates an express and socket server without listening immediately', () => {
  const app = createServerApp();

  assert.equal(typeof app.expressApp.use, 'function');
  assert.equal(typeof app.httpServer.listen, 'function');
  assert.equal(typeof app.io.on, 'function');
  assert.equal(typeof app.roomManager.createRoom, 'function');
});

test('serves a health check for deployment platforms', async () => {
  const app = createServerApp();
  await new Promise((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, service: 'catchmind-web' });
  } finally {
    await new Promise((resolve) => app.io.close(() => app.httpServer.close(resolve)));
  }
});
