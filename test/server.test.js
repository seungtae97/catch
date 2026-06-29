import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { AUTO_ADVANCE_DELAY_MS, createServerApp } from '../src/server.js';
import { RoomManager } from '../src/game/roomManager.js';

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

test('lets spectators join and chat without solving the answer', async () => {
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

    const spectator = await connectClient(url);
    sockets.push(spectator);
    const spectated = await emitAck(spectator, 'room:spectate', {
      code,
      name: 'Viewer',
      playerId: 'viewer-player'
    });
    const started = await emitAck(host, 'game:start');
    const chatReply = await emitAck(spectator, 'chat:send', {
      message: 'watching'
    });
    const answerReply = await emitAck(spectator, 'chat:send', {
      message: started.snapshot.currentTurn.word
    });
    const room = app.roomManager.rooms.get(code);

    assert.equal(spectated.ok, true);
    assert.equal(spectated.snapshot.viewer.isSpectator, true);
    assert.equal(spectated.snapshot.players.length, 2);
    assert.equal(spectated.snapshot.spectators.length, 1);
    assert.equal(chatReply.ok, true);
    assert.equal(chatReply.correct, false);
    assert.equal(answerReply.ok, false);
    assert.equal(answerReply.message, 'Spectators cannot submit answers');
    assert.equal(room.status, 'playing');
    assert.equal(room.messages.at(-1).message, 'watching');
    assert.equal(room.players.some((player) => player.socketId === spectator.id), false);
    assert.equal(room.spectators[0].socketId, spectator.id);
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await new Promise((resolve) => app.io.close(() => app.httpServer.close(resolve)));
  }
});

test('automatically advances five seconds after a correct guess', async () => {
  const app = createServerApp({ autoAdvanceDelayMs: 20 });
  await new Promise((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];

  try {
    const host = await connectClient(url);
    sockets.push(host);
    const created = await emitAck(host, 'room:create', {
      name: 'Host',
      playerId: 'host-player',
      maxRounds: 3,
      turnDurationSeconds: 60
    });
    const code = created.snapshot.code;

    const guest = await connectClient(url);
    sockets.push(guest);
    await emitAck(guest, 'room:join', {
      code,
      name: 'Guest',
      playerId: 'guest-player'
    });

    const started = await emitAck(host, 'game:start');
    const answer = started.snapshot.currentTurn.word;
    const advancedState = waitForRoomState(
      guest,
      (snapshot) => snapshot.status === 'playing' && snapshot.currentTurn?.drawerSocketId === guest.id
    );

    const reply = await emitAck(guest, 'chat:send', { message: answer });
    const advanced = await advancedState;

    assert.equal(AUTO_ADVANCE_DELAY_MS, 5000);
    assert.equal(reply.ok, true);
    assert.equal(reply.correct, true);
    assert.equal(advanced.round, 1);
    assert.equal(advanced.currentTurn.drawerSocketId, guest.id);
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await new Promise((resolve) => app.io.close(() => app.httpServer.close(resolve)));
  }
});

test('automatically advances five seconds after a turn timer expires', async () => {
  let now = Date.now() - 59990;
  const app = createServerApp({
    autoAdvanceDelayMs: 20,
    roomManager: new RoomManager({
      codeGenerator: () => 'TIME',
      words: ['alpha', 'bravo'],
      now: () => now
    })
  });
  await new Promise((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  const sockets = [];

  try {
    const host = await connectClient(url);
    sockets.push(host);
    await emitAck(host, 'room:create', {
      name: 'Host',
      playerId: 'host-player',
      turnDurationSeconds: 60
    });

    const guest = await connectClient(url);
    sockets.push(guest);
    await emitAck(guest, 'room:join', {
      code: 'TIME',
      name: 'Guest',
      playerId: 'guest-player'
    });

    const advancedState = waitForRoomState(
      guest,
      (snapshot) => snapshot.status === 'playing' && snapshot.currentTurn?.drawerSocketId === guest.id
    );

    await emitAck(host, 'game:start');
    now += 61000;
    const advanced = await advancedState;

    assert.equal(advanced.round, 1);
    assert.equal(advanced.currentTurn.drawerSocketId, guest.id);
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 1000);
    const ack = (reply) => {
      clearTimeout(timer);
      resolve(reply);
    };
    if (payload === undefined) {
      socket.emit(event, ack);
    } else {
      socket.emit(event, payload, ack);
    }
  });
}

function waitForRoomState(socket, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', handleState);
      reject(new Error('Timed out waiting for room state'));
    }, timeoutMs);

    const handleState = (snapshot) => {
      if (!predicate(snapshot)) {
        return;
      }
      clearTimeout(timer);
      socket.off('room:state', handleState);
      resolve(snapshot);
    };

    socket.on('room:state', handleState);
  });
}
