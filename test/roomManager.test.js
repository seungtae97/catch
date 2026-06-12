import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_PLAYERS, EXPANSION_MAX_PLAYERS, TURN_DURATION_SECONDS, DEFAULT_WORDS } from '../src/game/roomManager.js';

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

test('ships with a diverse built-in word pool', () => {
  const uniqueWords = new Set(DEFAULT_WORDS);

  assert.ok(DEFAULT_WORDS.length >= 80);
  assert.equal(uniqueWords.size, DEFAULT_WORDS.length);
  assert.ok(DEFAULT_WORDS.includes('타임머신'));
  assert.ok(DEFAULT_WORDS.includes('번개'));
  assert.ok(DEFAULT_WORDS.includes('치킨'));
});

test('draws words from a shuffled deck without repeats until the deck is exhausted', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'RAND',
    words: ['alpha', 'bravo', 'charlie', 'delta'],
    random: () => 0
  });
  rooms.createRoom({ socketId: 'host', name: 'Host' });
  rooms.joinRoom({ code: 'RAND', socketId: 'guest', name: 'Guest' });

  const seen = [];
  rooms.startGame({ code: 'RAND', socketId: 'host', viewerSocketId: 'host' });
  seen.push(rooms.rooms.get('RAND').currentTurn.word);
  for (let index = 0; index < 3; index += 1) {
    rooms.nextTurn({ code: 'RAND', socketId: 'host', viewerSocketId: 'host' });
    seen.push(rooms.rooms.get('RAND').currentTurn.word);
  }

  assert.deepEqual(seen, ['bravo', 'charlie', 'delta', 'alpha']);
  assert.equal(new Set(seen).size, 4);
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
    words: ['사과'],
    now: () => 1000
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'PLAY', socketId: 'guesser', name: 'Guesser' });

  const drawerView = rooms.startGame({ code: 'PLAY', socketId: 'drawer', viewerSocketId: 'drawer' });
  const guesserView = rooms.getSnapshotForSocket({ code: 'PLAY', viewerSocketId: 'guesser' });

  assert.equal(drawerView.currentTurn.drawerSocketId, 'drawer');
  assert.equal(drawerView.currentTurn.word, '사과');
  assert.equal(guesserView.currentTurn.word, null);
  assert.equal(guesserView.currentTurn.hint, '2글자');
  assert.equal(TURN_DURATION_SECONDS, 60);
  assert.equal(drawerView.currentTurn.endsAt, 61000);
  assert.equal(guesserView.currentTurn.remainingSeconds, 60);
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
    words: ['사과', '바다'],
    now: () => 5000
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'TURN', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'TURN', socketId: 'drawer', viewerSocketId: 'drawer' });

  const result = rooms.submitChat({ code: 'TURN', socketId: 'guesser', message: '사과' });
  const next = rooms.nextTurn({ code: 'TURN', socketId: 'drawer', viewerSocketId: 'guesser' });

  assert.equal(result.correct, true);
  assert.deepEqual(result.reveal, {
    word: '사과',
    guesserName: 'Guesser',
    guesserScore: 10,
    drawerName: 'Drawer',
    drawerScore: 5
  });
  assert.deepEqual(result.snapshot.lastReveal, {
    word: '사과',
    guesserName: 'Guesser',
    guesserScore: 10,
    drawerName: 'Drawer',
    drawerScore: 5
  });
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'guesser').score, 10);
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'drawer').score, 5);
  assert.equal(next.currentTurn.drawerSocketId, 'guesser');
  assert.equal(next.currentTurn.hint, '2글자');
  assert.equal(next.lastReveal, null);
});

test('expires a turn when the one minute timer runs out', () => {
  let now = 1000;
  const rooms = new RoomManager({
    codeGenerator: () => 'TIME',
    words: ['시계'],
    now: () => now
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'TIME', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'TIME', socketId: 'drawer', viewerSocketId: 'drawer' });

  now = 61001;
  const result = rooms.expireTurn({ code: 'TIME' });
  const snapshot = rooms.getSnapshotForSocket({ code: 'TIME', viewerSocketId: 'guesser' });

  assert.equal(result.expired, true);
  assert.equal(snapshot.status, 'turn-ended');
  assert.equal(snapshot.currentTurn.remainingSeconds, 0);
  assert.equal(snapshot.lastReveal.word, '시계');
  assert.equal(snapshot.lastReveal.guesserName, null);
  assert.equal(snapshot.lastReveal.guesserScore, 0);
});

test('does not award points for a correct guess after the timer ends', () => {
  let now = 1000;
  const rooms = new RoomManager({
    codeGenerator: () => 'LATE',
    words: ['시계'],
    now: () => now
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer' });
  rooms.joinRoom({ code: 'LATE', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'LATE', socketId: 'drawer', viewerSocketId: 'drawer' });

  now = 62000;
  const result = rooms.submitChat({ code: 'LATE', socketId: 'guesser', message: '시계' });

  assert.equal(result.correct, false);
  assert.equal(result.snapshot.status, 'turn-ended');
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'guesser').score, 0);
  assert.equal(result.snapshot.lastReveal.word, '시계');
});
