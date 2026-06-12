export const MAX_PLAYERS = 4;
export const EXPANSION_MAX_PLAYERS = 8;
export const TURN_DURATION_SECONDS = 60;
export const GUESSER_POINTS = 10;
export const DRAWER_POINTS = 5;

export const DEFAULT_WORDS = Object.freeze([
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
  '자동차',
  '달팽이',
  '우주선',
  '타임머신',
  '번개',
  '치킨',
  '떡볶이',
  '아이스크림',
  '눈사람',
  '드래곤',
  '마법사',
  '공룡',
  '기린',
  '펭귄',
  '상어',
  '문어',
  '나비',
  '꽃다발',
  '선인장',
  '해바라기',
  '무지개',
  '구름',
  '폭포',
  '화산',
  '등대',
  '성',
  '다리',
  '기차',
  '잠수함',
  '헬리콥터',
  '자전거',
  '스케이트',
  '로봇',
  '컴퓨터',
  '휴대폰',
  '카메라',
  '시계',
  '안경',
  '가방',
  '운동화',
  '왕관',
  '보물상자',
  '열쇠',
  '지도',
  '책',
  '연필',
  '붓',
  '팔레트',
  '마이크',
  '기타',
  '드럼',
  '바이올린',
  '케이크',
  '햄버거',
  '피자',
  '수박',
  '바나나',
  '포도',
  '딸기',
  '호박',
  '도넛',
  '컵라면',
  '우주인',
  '외계인',
  '유령',
  '좀비',
  '닌자',
  '해적',
  '기사',
  '경찰',
  '소방관',
  '의사',
  '요리사',
  '탐정',
  '축구공',
  '농구공',
  '야구방망이',
  '트로피',
  '텐트',
  '모닥불',
  '낚싯대',
  '눈썰매',
  '서핑보드',
  '풍선',
  '선물상자',
  '크리스마스트리',
  '할로윈호박',
  '팝콘',
  '영화관',
  '놀이공원',
  '회전목마',
  '관람차',
  '롤러코스터',
  '미끄럼틀',
  '그네',
  '침대',
  '소파',
  '냉장고',
  '세탁기',
  '엘리베이터',
  '에스컬레이터',
  '신호등',
  '횡단보도',
  '우체통',
  '편지',
  '하트',
  '별똥별'
]);

export class RoomManager {
  constructor({ codeGenerator = makeRoomCode, words = DEFAULT_WORDS, now = () => Date.now(), random = Math.random } = {}) {
    this.codeGenerator = codeGenerator;
    this.words = normalizeWordPool(words);
    this.now = now;
    this.random = random;
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
      lastReveal: null,
      lastWord: null,
      wordDeck: [],
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

  expireTurn({ code }) {
    const room = this.getRoom(code);
    if (room.status !== 'playing' || !room.currentTurn) {
      return { expired: false, snapshot: this.snapshot(room, room.players[0]?.socketId) };
    }
    if (this.remainingSeconds(room) > 0) {
      return { expired: false, snapshot: this.snapshot(room, room.players[0]?.socketId) };
    }

    room.status = 'turn-ended';
    room.currentTurn.solvedBy = null;
    room.lastReveal = {
      word: room.currentTurn.word,
      guesserName: null,
      guesserScore: 0,
      drawerName: room.currentTurn.drawerName,
      drawerScore: 0
    };

    return {
      expired: true,
      reveal: room.lastReveal,
      snapshot: this.snapshot(room, room.players[0]?.socketId)
    };
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

    if (room.status === 'playing' && room.currentTurn && this.remainingSeconds(room) <= 0) {
      this.expireTurn({ code: room.code });
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
      player.score += GUESSER_POINTS;
      const drawer = this.getPlayer(room, room.currentTurn.drawerSocketId);
      drawer.score += DRAWER_POINTS;
      room.status = 'turn-ended';
      room.currentTurn.solvedBy = socketId;
      room.lastReveal = {
        word: room.currentTurn.word,
        guesserName: player.name,
        guesserScore: GUESSER_POINTS,
        drawerName: drawer.name,
        drawerScore: DRAWER_POINTS
      };
    }

    return {
      correct,
      chat,
      reveal: correct ? room.lastReveal : null,
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
    room.lastReveal = null;
    const drawer = room.players[turnIndex];
    const word = this.drawWord(room);
    const startedAt = this.now();
    room.wordIndex += 1;
    room.currentTurn = {
      drawerSocketId: drawer.socketId,
      drawerName: drawer.name,
      word,
      hint: `${[...word].length}글자`,
      startedAt,
      endsAt: startedAt + TURN_DURATION_SECONDS * 1000,
      solvedBy: null
    };
  }

  drawWord(room) {
    if (!Array.isArray(room.wordDeck) || room.wordDeck.length === 0) {
      room.wordDeck = this.shuffleWords(room.lastWord);
    }

    const word = room.wordDeck.shift();
    room.lastWord = word;
    return word;
  }

  shuffleWords(previousWord) {
    const shuffled = [...this.words];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    if (shuffled.length > 1 && shuffled[0] === previousWord) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }

    return shuffled;
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
      lastReveal: room.lastReveal ? { ...room.lastReveal } : null,
      currentTurn: room.currentTurn
        ? {
            drawerSocketId: room.currentTurn.drawerSocketId,
            drawerName: room.currentTurn.drawerName,
            word: isDrawer ? room.currentTurn.word : null,
            hint: room.currentTurn.hint,
            startedAt: room.currentTurn.startedAt,
            endsAt: room.currentTurn.endsAt,
            remainingSeconds: this.remainingSeconds(room),
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

  remainingSeconds(room) {
    if (!room.currentTurn?.endsAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((room.currentTurn.endsAt - this.now()) / 1000));
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

function normalizeWordPool(words) {
  const normalized = [...new Set(
    words
      .map((word) => String(word ?? '').trim())
      .filter(Boolean)
  )];

  if (normalized.length === 0) {
    throw new Error('At least one word is required');
  }

  return normalized;
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
