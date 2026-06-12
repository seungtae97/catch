import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { createServerApp } from '../src/server.js';

test('reattaches a reconnecting player before sending chat', async () => {
  const app = createServerApp();
  await new Promise((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];

  try {
    const host = await connectClient(url);
    sockets.push(host);
    const created = await emitAck(host, 'room:create', {
      name: 'Host',
      playerId: 'host-player'
    });
    const code = created.snapshot.code;

    const guest = await connectClient(url);
    sockets.push(guest);
    await emitAck(guest, 'room:join', {
      code,
      name: 'Guest',
      playerId: 'guest-player'
    });

    host.disconnect();
    await wait(100);

    const reconnectedHost = await connectClient(url);
    sockets.push(reconnectedHost);
    const reply = await emitAck(reconnectedHost, 'chat:send', {
      code,
      name: 'Host',
      playerId: 'host-player',
      message: 'after reconnect'
    });

    const room = app.roomManager.rooms.get(code);

    assert.equal(reply.ok, true);
    assert.equal(room.players.length, 2);
    assert.equal(room.players.find((player) => player.id === 'host-player').socketId, reconnectedHost.id);
    assert.equal(room.messages.at(-1).message, 'after reconnect');
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await new Promise((resolve) => app.io.close(() => app.httpServer.close(resolve)));
  }
});

function connectClient(url) {
  const socket = Client(url, {
    reconnection: false,
    transports: ['websocket']
  });

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
