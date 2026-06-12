import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_PLAYERS, EXPANSION_MAX_PLAYERS } from '../src/game/roomManager.js';

test('creates a room with a host player and scalable player caps', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'ABCD' });

  const snapshot = rooms.createRoom({ socketId: 's1', name: 'Mina' });

  assert.equal(MAX_PLAYERS, 4);
  assert.equal(EXPANSION_MAX_PLAYERS, 8);
  assert.equal(snapshot.code, 'ABCD');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].name, 'Mina');
  assert.equal(snapshot.players[0].isHost, true);
});

test('rejects joins after the current 4-player limit', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'ROOM' });
  rooms.createRoom({ socketId: 's1', name: 'A' });
  rooms.joinRoom({ code: 'ROOM', socketId: 's2', name: 'B' });
  rooms.joinRoom({ code: 'ROOM', socketId: 's3', name: 'C' });
  rooms.joinRoom({ code: 'ROOM', socketId: 's4', name: 'D' });

  assert.throws(
    () => rooms.joinRoom({ code: 'ROOM', socketId: 's5', name: 'E' }),
    /Room is full/
  );
});

test('starts a turn with a drawer and hides the word from guessers', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'PLAY',
    words: ['사과']
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'PLAY', socketId: 'guesser', name: 'Guesser' });

  const drawerView = rooms.startGame({ code: 'PLAY', socketId: 'drawer', viewerSocketId: 'drawer' });
  const guesserView = rooms.getSnapshotForSocket({ code: 'PLAY', viewerSocketId: 'guesser' });

  assert.equal(drawerView.currentTurn.drawerSocketId, 'drawer');
  assert.equal(drawerView.currentTurn.word, '사과');
  assert.equal(guesserView.currentTurn.word, null);
  assert.equal(guesserView.currentTurn.hint, '2글자');
});

test('accepts drawing only from the active drawer', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'DRAW', words: ['바다'] });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'DRAW', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'DRAW', socketId: 'drawer', viewerSocketId: 'drawer' });

  const stroke = { color: '#111111', size: 6, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.deepEqual(rooms.addStroke({ code: 'DRAW', socketId: 'drawer', stroke }), stroke);
  assert.throws(
    () => rooms.addStroke({ code: 'DRAW', socketId: 'guesser', stroke }),
    /Only the drawer/
  );
});

test('scores a correct guess and advances to the next drawer', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'TURN',
    words: ['사과', '바다']
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'TURN', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'TURN', socketId: 'drawer', viewerSocketId: 'drawer' });

  const result = rooms.submitChat({ code: 'TURN', socketId: 'guesser', message: '사과' });
  const next = rooms.nextTurn({ code: 'TURN', socketId: 'drawer', viewerSocketId: 'guesser' });

  assert.equal(result.correct, true);
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'guesser').score, 10);
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'drawer').score, 5);
  assert.equal(next.currentTurn.drawerSocketId, 'guesser');
  assert.equal(next.currentTurn.hint, '2글자');
});
