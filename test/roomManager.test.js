import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomManager,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  EXPANSION_MAX_PLAYERS,
  MAX_ROUNDS,
  ROUND_OPTIONS,
  TURN_DURATION_SECONDS,
  TURN_DURATION_OPTIONS_SECONDS,
  DEFAULT_WORDS
} from '../src/game/roomManager.js';

test('creates a room with a host player and scalable player caps', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'ABCD' });

  const snapshot = rooms.createRoom({ socketId: 's1', name: 'Mina' });

  assert.equal(MAX_PLAYERS, 8);
  assert.equal(MAX_SPECTATORS, 4);
  assert.equal(EXPANSION_MAX_PLAYERS, 8);
  assert.equal(MAX_ROUNDS, 10);
  assert.deepEqual(ROUND_OPTIONS, [3, 5, 7, 10]);
  assert.deepEqual(TURN_DURATION_OPTIONS_SECONDS, [60, 120, 180, 300]);
  assert.equal(snapshot.code, 'ABCD');
  assert.equal(snapshot.maxPlayers, 8);
  assert.equal(snapshot.maxSpectators, 4);
  assert.equal(snapshot.maxRounds, 3);
  assert.equal(snapshot.turnDurationSeconds, 120);
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.spectators.length, 0);
  assert.equal(snapshot.players[0].name, 'Mina');
  assert.equal(snapshot.players[0].isHost, true);
});

test('adds up to four spectators without consuming player slots', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'SPEC',
    words: ['alpha', 'bravo'],
    random: () => 0
  });
  rooms.createRoom({ socketId: 'host', name: 'Host' });
  for (let player = 2; player <= 8; player += 1) {
    rooms.joinRoom({ code: 'SPEC', socketId: `p${player}`, name: `P${player}` });
  }
  for (let spectator = 1; spectator <= 4; spectator += 1) {
    rooms.spectateRoom({ code: 'SPEC', socketId: `v${spectator}`, name: `Viewer${spectator}` });
  }

  const snapshot = rooms.getSnapshotForSocket({ code: 'SPEC', viewerSocketId: 'v1' });
  assert.equal(snapshot.players.length, 8);
  assert.equal(snapshot.spectators.length, 4);
  assert.equal(snapshot.viewer.isSpectator, true);
  assert.equal(snapshot.viewer.isDrawer, false);
  assert.equal(snapshot.viewer.isHost, false);

  assert.throws(
    () => rooms.spectateRoom({ code: 'SPEC', socketId: 'v5', name: 'Viewer5' }),
    /Spectator room is full/
  );
});

test('spectators can chat but cannot solve, draw, or advance turns', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'VIEW',
    words: ['alpha', 'bravo'],
    random: () => 0
  });
  rooms.createRoom({ socketId: 'host', name: 'Host' });
  rooms.joinRoom({ code: 'VIEW', socketId: 'guest', name: 'Guest' });
  rooms.spectateRoom({ code: 'VIEW', socketId: 'viewer', name: 'Viewer' });
  const started = rooms.startGame({ code: 'VIEW', socketId: 'host', viewerSocketId: 'host' });

  const result = rooms.submitChat({ code: 'VIEW', socketId: 'viewer', message: 'hello' });

  assert.equal(result.correct, false);
  assert.equal(result.snapshot.status, 'playing');
  assert.equal(result.chat.message, 'hello');
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'viewer'), undefined);
  assert.equal(result.snapshot.spectators[0].name, 'Viewer');
  assert.throws(
    () => rooms.submitChat({ code: 'VIEW', socketId: 'viewer', message: started.currentTurn.word }),
    /Spectators cannot submit answers/
  );
  assert.throws(
    () => rooms.addStroke({ code: 'VIEW', socketId: 'viewer', stroke: { points: [{ x: 1, y: 1 }] } }),
    /Only the drawer can draw/
  );
  assert.throws(
    () => rooms.nextTurn({ code: 'VIEW', socketId: 'viewer', viewerSocketId: 'viewer' }),
    /Only the host can advance the turn/
  );
});

test('stores host-selected round and drawing time options', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'OPTS',
    words: ['alpha'],
    now: () => 1000
  });

  rooms.createRoom({
    socketId: 'host',
    name: 'Host',
    maxRounds: 7,
    turnDurationSeconds: 180
  });
  rooms.joinRoom({ code: 'OPTS', socketId: 'guest', name: 'Guest' });

  const snapshot = rooms.startGame({ code: 'OPTS', socketId: 'host', viewerSocketId: 'host' });

  assert.equal(snapshot.maxRounds, 7);
  assert.equal(snapshot.turnDurationSeconds, 180);
  assert.equal(snapshot.currentTurn.endsAt, 181000);
  assert.equal(snapshot.currentTurn.remainingSeconds, 180);
});

test('ships with a diverse built-in word pool', () => {
  const uniqueWords = new Set(DEFAULT_WORDS);

  assert.ok(DEFAULT_WORDS.length >= 650);
  assert.equal(uniqueWords.size, DEFAULT_WORDS.length);
  assert.ok(DEFAULT_WORDS.includes('타임머신'));
  assert.ok(DEFAULT_WORDS.includes('번개'));
  assert.ok(DEFAULT_WORDS.includes('치킨'));
  assert.ok(DEFAULT_WORDS.includes('경복궁'));
  assert.ok(DEFAULT_WORDS.includes('모나리자'));
  assert.ok(DEFAULT_WORDS.includes('나이아가라폭포'));
  assert.ok(DEFAULT_WORDS.includes('방사선'));
  assert.ok(DEFAULT_WORDS.includes('전자현미경'));
  assert.ok(DEFAULT_WORDS.includes('만리장성'));
  assert.equal(DEFAULT_WORDS.includes('판옵티콘'), false);
  assert.equal(DEFAULT_WORDS.includes('방사선복'), false);
});

test('finishes the game after the selected number of complete rounds', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'DONE',
    words: ['alpha', 'bravo', 'charlie', 'delta'],
    random: () => 0
  });
  rooms.createRoom({ socketId: 'host', name: 'Host', maxRounds: 3 });
  rooms.joinRoom({ code: 'DONE', socketId: 'guest', name: 'Guest' });

  rooms.startGame({ code: 'DONE', socketId: 'host', viewerSocketId: 'host' });
  for (let turn = 1; turn < 3 * 2; turn += 1) {
    rooms.nextTurn({ code: 'DONE', socketId: 'host', viewerSocketId: 'host' });
  }

  const finalTurn = rooms.rooms.get('DONE').currentTurn;
  assert.equal(finalTurn.drawerSocketId, 'guest');
  assert.equal(rooms.rooms.get('DONE').round, 3);

  const finished = rooms.nextTurn({ code: 'DONE', socketId: 'host', viewerSocketId: 'host' });

  assert.equal(finished.status, 'finished');
  assert.equal(finished.round, 3);
  assert.equal(finished.maxRounds, 3);
  assert.equal(finished.currentTurn, null);
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

test('rejects joins after the current 8-player limit', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'ROOM' });
  rooms.createRoom({ socketId: 's1', name: 'A' });
  for (let player = 2; player <= 8; player += 1) {
    rooms.joinRoom({ code: 'ROOM', socketId: `s${player}`, name: `P${player}` });
  }

  assert.equal(rooms.getSnapshotForSocket({ code: 'ROOM', viewerSocketId: 's1' }).players.length, 8);

  assert.throws(
    () => rooms.joinRoom({ code: 'ROOM', socketId: 's9', name: 'P9' }),
    /Room is full/
  );
});

test('allows only the host to manually advance the turn', () => {
  const rooms = new RoomManager({
    codeGenerator: () => 'HOST',
    words: ['alpha', 'bravo'],
    random: () => 0
  });
  rooms.createRoom({ socketId: 'host', name: 'Host' });
  rooms.joinRoom({ code: 'HOST', socketId: 'guest', name: 'Guest' });
  rooms.startGame({ code: 'HOST', socketId: 'host', viewerSocketId: 'host' });
  rooms.nextTurn({ code: 'HOST', socketId: 'host', viewerSocketId: 'host' });

  assert.equal(rooms.rooms.get('HOST').currentTurn.drawerSocketId, 'guest');
  assert.throws(
    () => rooms.nextTurn({ code: 'HOST', socketId: 'guest', viewerSocketId: 'guest' }),
    /Only the host can advance the turn/
  );

  const advanced = rooms.nextTurn({ code: 'HOST', socketId: 'host', viewerSocketId: 'host' });
  assert.equal(advanced.currentTurn.drawerSocketId, 'host');
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
  assert.equal(TURN_DURATION_SECONDS, 120);
  assert.equal(drawerView.currentTurn.endsAt, 121000);
  assert.equal(guesserView.currentTurn.remainingSeconds, 120);
});

test('accepts drawing only from the active drawer', () => {
  const rooms = new RoomManager({ codeGenerator: () => 'DRAW', words: ['바다'] });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer', turnDurationSeconds: 60 });
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
    now: () => 5000,
    random: () => 0.99
  });
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer', turnDurationSeconds: 60 });
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
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer', turnDurationSeconds: 60 });
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
  rooms.createRoom({ socketId: 'drawer', name: 'Drawer', turnDurationSeconds: 60 });
  rooms.joinRoom({ code: 'LATE', socketId: 'guesser', name: 'Guesser' });
  rooms.startGame({ code: 'LATE', socketId: 'drawer', viewerSocketId: 'drawer' });

  now = 62000;
  const result = rooms.submitChat({ code: 'LATE', socketId: 'guesser', message: '시계' });

  assert.equal(result.correct, false);
  assert.equal(result.snapshot.status, 'turn-ended');
  assert.equal(result.snapshot.players.find((player) => player.socketId === 'guesser').score, 0);
  assert.equal(result.snapshot.lastReveal.word, '시계');
});
