export const MAX_PLAYERS = 4;
export const EXPANSION_MAX_PLAYERS = 8;

const DEFAULT_WORDS = [
  '사과',
  '바다',
  '학교',
  '고양이',
  '비행기',
  '라면',
  '축구',
  '우산',
  '피아노',
  '강아지',
  '김치',
  '자동차'
];

export class RoomManager {
  constructor({ codeGenerator = makeRoomCode, words = DEFAULT_WORDS } = {}) {
    this.codeGenerator = codeGenerator;
    this.words = words;
    this.rooms = new Map();
  }

  createRoom({ socketId, name }) {
    const player = createPlayer({ socketId, name, isHost: true });
    const code = this.createUniqueCode();
    const room = {
      code,
      players: [player],
      messages: [],
      strokes: [],
      status: 'waiting',
      currentTurn: null,
      turnIndex: 0,
      round: 0,
      wordIndex: 0
    };

    this.rooms.set(code, room);
    return this.snapshot(room, socketId);
  }

  joinRoom({ code, socketId, name }) {
    const room = this.getRoom(code);
    if (room.players.some((player) => player.socketId === socketId)) {
      return this.snapshot(room, socketId);
    }
    if (room.players.length >= MAX_PLAYERS) {
      throw new Error('Room is full');
    }

    room.players.push(createPlayer({ socketId, name, isHost: false }));
    return this.snapshot(room, socketId);
  }

  startGame({ code, socketId, viewerSocketId = socketId }) {
    const room = this.getRoom(code);
    this.requireHost(room, socketId);
    if (room.players.length < 2) {
      throw new Error('At least 2 players are required');
    }

    room.status = 'playing';
    room.round = Math.max(room.round, 1);
    this.beginTurn(room, room.turnIndex);
    return this.snapshot(room, viewerSocketId);
  }

  nextTurn({ code, socketId, viewerSocketId = socketId }) {
    const room = this.getRoom(code);
    if (room.status !== 'playing' && room.status !== 'turn-ended') {
      throw new Error('Game has not started');
    }
    const isDrawer = room.currentTurn?.drawerSocketId === socketId;
    const isHost = room.players.find((player) => player.socketId === socketId)?.isHost;
    if (!isDrawer && !isHost) {
      throw new Error('Only the drawer or host can advance the turn');
    }

    const nextIndex = (room.turnIndex + 1) % room.players.length;
    if (nextIndex === 0) {
      room.round += 1;
    }
    this.beginTurn(room, nextIndex);
    return this.snapshot(room, viewerSocketId);
  }

  getSnapshotForSocket({ code, viewerSocketId }) {
    return this.snapshot(this.getRoom(code), viewerSocketId);
  }

  addStroke({ code, socketId, stroke }) {
    const room = this.getRoom(code);
    this.requireDrawer(room, socketId);
    const normalized = normalizeStroke(stroke);
    room.strokes.push(normalized);
    return normalized;
  }

  clearCanvas({ code, socketId }) {
    const room = this.getRoom(code);
    this.requireDrawer(room, socketId);
    room.strokes = [];
    return this.snapshot(room, socketId);
  }

  submitChat({ code, socketId, message }) {
    const room = this.getRoom(code);
    const player = this.getPlayer(room, socketId);
    const text = String(message ?? '').trim();
    if (!text) {
      throw new Error('Message is required');
    }

    const correct = room.status === 'playing'
      && room.currentTurn
      && socketId !== room.currentTurn.drawerSocketId
      && text.localeCompare(room.currentTurn.word, 'ko', { sensitivity: 'base' }) === 0;

    const chat = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      playerId: socketId,
      playerName: player.name,
      message: correct ? '정답!' : text,
      correct,
      createdAt: Date.now()
    };

    room.messages.push(chat);
    if (correct) {
      player.score += 10;
      const drawer = this.getPlayer(room, room.currentTurn.drawerSocketId);
      drawer.score += 5;
      room.status = 'turn-ended';
      room.currentTurn.solvedBy = socketId;
    }

    return {
      correct,
      chat,
      snapshot: this.snapshot(room, socketId)
    };
  }

  removePlayer(socketId) {
    for (const [code, room] of this.rooms) {
      const index = room.players.findIndex((player) => player.socketId === socketId);
      if (index === -1) {
        continue;
      }

      room.players.splice(index, 1);
      if (room.players.length === 0) {
        this.rooms.delete(code);
        return { code, deleted: true };
      }

      room.players[0].isHost = true;
      if (room.turnIndex >= room.players.length) {
        room.turnIndex = 0;
      }
      if (room.currentTurn?.drawerSocketId === socketId && room.status !== 'waiting') {
        this.beginTurn(room, room.turnIndex);
      }
      return { code, snapshot: this.snapshot(room, room.players[0].socketId) };
    }

    return null;
  }

  createUniqueCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = this.codeGenerator();
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Could not create room code');
  }

  beginTurn(room, turnIndex) {
    room.turnIndex = turnIndex;
    room.strokes = [];
    room.status = 'playing';
    const drawer = room.players[turnIndex];
    const word = this.words[room.wordIndex % this.words.length];
    room.wordIndex += 1;
    room.currentTurn = {
      drawerSocketId: drawer.socketId,
      drawerName: drawer.name,
      word,
      hint: `${[...word].length}글자`,
      solvedBy: null
    };
  }

  snapshot(room, viewerSocketId) {
    const isDrawer = room.currentTurn?.drawerSocketId === viewerSocketId;
    return {
      code: room.code,
      maxPlayers: MAX_PLAYERS,
      expansionMaxPlayers: EXPANSION_MAX_PLAYERS,
      status: room.status,
      round: room.round,
      players: room.players.map((player) => ({ ...player })),
      messages: room.messages.slice(-60),
      strokes: room.strokes,
      currentTurn: room.currentTurn
        ? {
            drawerSocketId: room.currentTurn.drawerSocketId,
            drawerName: room.currentTurn.drawerName,
            word: isDrawer ? room.currentTurn.word : null,
            hint: room.currentTurn.hint,
            solvedBy: room.currentTurn.solvedBy
          }
        : null,
      viewer: {
        socketId: viewerSocketId,
        isDrawer: Boolean(isDrawer),
        isHost: Boolean(room.players.find((player) => player.socketId === viewerSocketId)?.isHost)
      }
    };
  }

  getRoom(code) {
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) {
      throw new Error('Room not found');
    }
    return room;
  }

  getPlayer(room, socketId) {
    const player = room.players.find((candidate) => candidate.socketId === socketId);
    if (!player) {
      throw new Error('Player not found');
    }
    return player;
  }

  requireHost(room, socketId) {
    if (!this.getPlayer(room, socketId).isHost) {
      throw new Error('Only the host can start the game');
    }
  }

  requireDrawer(room, socketId) {
    if (room.status !== 'playing' || room.currentTurn?.drawerSocketId !== socketId) {
      throw new Error('Only the drawer can draw');
    }
  }
}

function createPlayer({ socketId, name, isHost }) {
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) {
    throw new Error('Name is required');
  }

  return {
    socketId,
    name: trimmedName.slice(0, 16),
    score: 0,
    isHost
  };
}

function normalizeStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    throw new Error('Stroke points are required');
  }

  return {
    color: typeof stroke.color === 'string' ? stroke.color : '#111111',
    size: Number.isFinite(stroke.size) ? Math.min(Math.max(stroke.size, 1), 30) : 6,
    points: stroke.points.map((point) => ({
      x: Number(point.x),
      y: Number(point.y)
    })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  };
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
