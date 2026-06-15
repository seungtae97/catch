const socket = io();
const PLAYER_ID_KEY = 'catchmind:player-id';

const entryView = document.querySelector('#entryView');
const gameView = document.querySelector('#gameView');
const entryForm = document.querySelector('#entryForm');
const nameInput = document.querySelector('#nameInput');
const roomInput = document.querySelector('#roomInput');
const createRoomBtn = document.querySelector('#createRoomBtn');
const entryError = document.querySelector('#entryError');
const roomCode = document.querySelector('#roomCode');
const roundText = document.querySelector('#roundText');
const wordText = document.querySelector('#wordText');
const timerText = document.querySelector('#timerText');
const startBtn = document.querySelector('#startBtn');
const nextTurnBtn = document.querySelector('#nextTurnBtn');
const playerCount = document.querySelector('#playerCount');
const playerList = document.querySelector('#playerList');
const socketStatus = document.querySelector('#socketStatus');
const canvas = document.querySelector('#drawingCanvas');
const colorSwatches = document.querySelector('#colorSwatches');
const sizeOptions = document.querySelector('#sizeOptions');
const clearBtn = document.querySelector('#clearBtn');
const drawLock = document.querySelector('#drawLock');
const turnNotice = document.querySelector('#turnNotice');
const resultOverlay = document.querySelector('#resultOverlay');
const resultTitle = document.querySelector('#resultTitle');
const resultDetail = document.querySelector('#resultDetail');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const confetti = document.querySelector('#confetti');
const ctx = canvas.getContext('2d');

const PEN_COLORS = [
  { name: '흰', value: '#ffffff' },
  { name: '검', value: '#111111' },
  { name: '빨', value: '#e53935' },
  { name: '주', value: '#fb8c00' },
  { name: '노', value: '#fdd835' },
  { name: '초', value: '#43a047' },
  { name: '파', value: '#1e88e5' },
  { name: '남', value: '#283593' },
  { name: '보', value: '#8e24aa' }
];
const PEN_SIZES = [4, 8, 14, 20, 28];
let selectedColor = '#111111';
let selectedSize = 8;
let lastRevealKey = null;
buildPenControls();

let state = null;
let drawing = false;
let currentStroke = null;
let localTurnDeadline = null;
let activeTurnKey = null;
let currentSession = null;
const playerId = getOrCreatePlayerId();

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

setInterval(updateTimerText, 250);

socket.on('connect', () => {
  socketStatus.textContent = '연결됨';
  rejoinCurrentRoom();
});

socket.on('disconnect', () => {
  socketStatus.textContent = '끊김';
});

socket.on('app:error', ({ message }) => {
  showError(message);
});

socket.on('room:state', (snapshot) => {
  state = snapshot;
  renderState();
});

socket.on('draw:stroke', (stroke) => {
  drawStroke(stroke);
});

socket.on('draw:clear', () => {
  clearCanvas();
});

socket.on('chat:message', (message) => {
  appendMessage(message);
  showPlayerBubble(message);
});

createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  requestRoom('room:create', { name, playerId });
});

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();
  requestRoom('room:join', { name, code, playerId });
});

startBtn.addEventListener('click', () => {
  socket.emit('game:start', handleReply);
});

nextTurnBtn.addEventListener('click', () => {
  socket.emit('turn:next', handleReply);
});

clearBtn.addEventListener('click', () => {
  if (canDraw()) {
    socket.emit('draw:clear');
  }
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }
  socket.emit('chat:send', {
    message,
    code: currentSession?.code ?? state?.code,
    name: currentSession?.name,
    playerId
  }, handleReply);
  chatInput.value = '';
});

canvas.addEventListener('pointerdown', (event) => {
  if (!canDraw()) {
    return;
  }
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  currentStroke = {
    color: selectedColor,
    size: selectedSize,
    points: [canvasPoint(event)]
  };
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || !currentStroke) {
    return;
  }
  const point = canvasPoint(event);
  const previous = currentStroke.points[currentStroke.points.length - 1];
  currentStroke.points.push(point);
  drawSegment(previous, point, currentStroke);
});

canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);

function requestRoom(eventName, payload) {
  entryError.textContent = '';
  socket.emit(eventName, payload, (reply) => {
    if (!reply?.ok) {
      showError(reply?.message ?? '요청을 처리하지 못했습니다');
      return;
    }
    state = reply.snapshot;
    currentSession = {
      code: reply.snapshot.code,
      name: payload.name
    };
    entryView.classList.add('hidden');
    gameView.classList.remove('hidden');
    renderState();
  });
}

function rejoinCurrentRoom() {
  if (!currentSession?.code || !currentSession.name || !state) {
    return;
  }

  socket.emit('room:join', {
    code: currentSession.code,
    name: currentSession.name,
    playerId
  }, (reply) => {
    if (!reply?.ok) {
      showError(reply?.message ?? '재연결에 실패했습니다');
      return;
    }
    state = reply.snapshot;
    renderState();
  });
}

function handleReply(reply) {
  if (!reply?.ok && reply?.message) {
    showError(reply.message);
  }
}

function showError(message) {
  const text = koreanError(message);
  entryError.textContent = text;
  if (!gameView.classList.contains('hidden')) {
    appendMessage({
      playerName: '시스템',
      message: text,
      correct: false
    });
  }
}

function koreanError(message) {
  const map = {
    'Room is full': '방이 가득 찼습니다',
    'Room not found': '방을 찾을 수 없습니다',
    'Name is required': '닉네임을 입력하세요',
    'At least 2 players are required': '최소 2명이 필요합니다',
    'Only the host can start the game': '방장만 시작할 수 있습니다',
    'Only the drawer can draw': '그리는 사람만 그릴 수 있습니다',
    'Only the drawer or host can advance the turn': '그리는 사람 또는 방장만 넘길 수 있습니다'
  };
  return map[message] ?? message;
}

function renderState() {
  if (!state) {
    return;
  }
  entryView.classList.add('hidden');
  gameView.classList.remove('hidden');
  roomCode.textContent = state.code;
  playerCount.textContent = `${state.players.length}/${state.maxPlayers}`;
  roundText.textContent = state.status === 'waiting'
    ? '대기 중'
    : `${state.round}/${state.maxRounds ?? 10}라운드`;

  if (state.status === 'finished') {
    wordText.textContent = '게임 종료! 최종 점수를 확인하세요';
    timerText.textContent = '--초';
  } else if (!state.currentTurn) {
    wordText.textContent = '방장이 게임을 시작하세요';
    timerText.textContent = '--초';
  } else if (state.viewer.isDrawer) {
    wordText.textContent = `내 차례입니다! 제시어: ${state.currentTurn.word}`;
  } else if (state.status === 'turn-ended') {
    wordText.textContent = `정답 완료: ${state.currentTurn.drawerName}의 차례`;
  } else {
    wordText.textContent = `${state.currentTurn.drawerName} 그림 | 힌트 ${state.currentTurn.hint}`;
  }

  syncTurnDeadline();
  updateTimerText();

  startBtn.disabled = !state.viewer.isHost || state.status !== 'waiting' || state.players.length < 2;
  nextTurnBtn.disabled = !state.currentTurn || (!state.viewer.isDrawer && !state.viewer.isHost);
  clearBtn.disabled = !canDraw();
  canvas.classList.toggle('locked', !canDraw());
  drawLock.textContent = canDraw() ? '지금 그릴 차례입니다' : '그리는 차례가 아닙니다';
  chatInput.placeholder = state.status === 'finished'
    ? '게임이 종료되었습니다'
    : state.viewer.isDrawer ? '그리는 사람은 채팅만 가능' : '정답 또는 채팅 입력';

  renderPlayers();
  renderMessages();
  renderTurnNotice();
  renderReveal();
  redrawCanvas();
}

function syncTurnDeadline() {
  if (!state?.currentTurn || state.status !== 'playing') {
    activeTurnKey = null;
    localTurnDeadline = null;
    return;
  }

  const turnKey = `${state.currentTurn.drawerSocketId}-${state.currentTurn.endsAt}`;
  if (turnKey !== activeTurnKey) {
    activeTurnKey = turnKey;
    localTurnDeadline = Date.now() + (state.currentTurn.remainingSeconds ?? 0) * 1000;
  }
}

function updateTimerText() {
  if (!timerText) {
    return;
  }
  if (!state?.currentTurn) {
    timerText.textContent = '--초';
    return;
  }

  const remaining = state.status === 'playing' && localTurnDeadline
    ? Math.max(0, Math.ceil((localTurnDeadline - Date.now()) / 1000))
    : Math.max(0, state.currentTurn.remainingSeconds ?? 0);
  timerText.textContent = `${remaining}초`;
}

function renderTurnNotice() {
  if (!turnNotice) {
    return;
  }
  turnNotice.classList.toggle('hidden', !canDraw());
  turnNotice.textContent = '내 차례입니다';
}

function renderReveal() {
  if (!resultOverlay || !resultTitle || !resultDetail) {
    return;
  }
  const reveal = state?.lastReveal;
  if (!reveal) {
    resultOverlay.classList.add('hidden');
    resultTitle.textContent = '';
    resultDetail.textContent = '';
    lastRevealKey = null;
    return;
  }

  const revealKey = `${reveal.word}-${reveal.guesserName ?? ''}-${reveal.drawerName ?? ''}`;
  const isNewReveal = revealKey !== lastRevealKey;
  lastRevealKey = revealKey;

  resultOverlay.classList.remove('hidden');
  if (reveal.guesserName) {
    resultTitle.textContent = `정답: ${reveal.word}`;
    resultDetail.textContent = `${reveal.guesserName} +${reveal.guesserScore}점, ${reveal.drawerName} +${reveal.drawerScore}점`;
    if (isNewReveal) {
      launchConfetti();
    }
  } else {
    resultTitle.textContent = `시간 종료! 정답: ${reveal.word}`;
    resultDetail.textContent = '이번 차례는 점수 없이 종료됐습니다';
  }
}

function renderPlayers() {
  playerList.innerHTML = '';
  for (const player of state.players) {
    const item = document.createElement('li');
    item.dataset.socketId = player.socketId;
    const name = document.createElement('strong');
    const score = document.createElement('span');
    const badges = document.createElement('div');
    name.textContent = player.name;
    score.textContent = `${player.score}점`;
    badges.className = 'badges';
    if (player.isHost) {
      badges.append(makeBadge('방장'));
    }
    if (state.currentTurn?.drawerSocketId === player.socketId) {
      badges.append(makeBadge('그림', 'gold'));
    }
    item.append(name, score, badges);
    playerList.append(item);
  }
}

function renderMessages() {
  messages.innerHTML = '';
  for (const message of state.messages) {
    appendMessage(message);
  }
}

function appendMessage(message) {
  const row = document.createElement('div');
  const name = document.createElement('b');
  const text = document.createElement('span');
  row.className = `message${message.correct ? ' correct' : ''}`;
  name.textContent = message.playerName;
  text.textContent = message.message;
  row.append(name, text);
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}

function makeBadge(text, tone = '') {
  const badge = document.createElement('span');
  badge.className = `badge ${tone}`.trim();
  const icon = text === '방장' ? '👑 ' : text === '그림' ? '🎨 ' : '';
  badge.textContent = `${icon}${text}`;
  return badge;
}

function buildPenControls() {
  for (const color of PEN_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color.value;
    btn.title = color.name;
    btn.setAttribute('aria-label', `${color.name}색`);
    btn.classList.toggle('active', color.value === selectedColor);
    btn.addEventListener('click', () => {
      selectedColor = color.value;
      for (const node of colorSwatches.children) {
        node.classList.toggle('active', node === btn);
      }
    });
    colorSwatches.append(btn);
  }

  const maxSize = PEN_SIZES[PEN_SIZES.length - 1];
  for (const size of PEN_SIZES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'size-btn';
    btn.title = `${size}px`;
    btn.setAttribute('aria-label', `굵기 ${size}`);
    const dot = document.createElement('span');
    dot.className = 'dot';
    const diameter = Math.round(6 + (size / maxSize) * 16);
    dot.style.width = `${diameter}px`;
    dot.style.height = `${diameter}px`;
    btn.append(dot);
    btn.classList.toggle('active', size === selectedSize);
    btn.addEventListener('click', () => {
      selectedSize = size;
      for (const node of sizeOptions.children) {
        node.classList.toggle('active', node === btn);
      }
    });
    sizeOptions.append(btn);
  }
}

function showPlayerBubble(message) {
  if (!message?.playerId || gameView.classList.contains('hidden')) {
    return;
  }
  const item = playerList.querySelector(`li[data-socket-id="${message.playerId}"]`);
  if (!item) {
    return;
  }

  const existing = item._bubble;
  if (existing) {
    existing.remove();
    clearTimeout(item._bubbleTimer);
  }

  const bubble = document.createElement('div');
  bubble.className = `speech-bubble${message.correct ? ' correct' : ''}`;
  bubble.textContent = message.message;
  document.body.append(bubble);

  const rect = item.getBoundingClientRect();
  bubble.style.left = `${rect.left + rect.width / 2}px`;
  bubble.style.top = `${rect.top - 8}px`;

  item._bubble = bubble;
  item._bubbleTimer = setTimeout(() => {
    bubble.classList.add('fade-out');
    setTimeout(() => bubble.remove(), 300);
    item._bubble = null;
  }, 3000);
}

function launchConfetti() {
  if (!confetti) {
    return;
  }
  const pieces = ['🎉', '⭐', '✨', '🎊', '💖', '🌈', '🍬'];
  confetti.innerHTML = '';
  for (let i = 0; i < 28; i += 1) {
    const span = document.createElement('span');
    span.textContent = pieces[i % pieces.length];
    span.style.left = `${Math.random() * 100}%`;
    span.style.animationDuration = `${1.4 + Math.random() * 1.4}s`;
    span.style.animationDelay = `${Math.random() * 0.4}s`;
    confetti.append(span);
  }
  setTimeout(() => {
    confetti.innerHTML = '';
  }, 3200);
}

function canDraw() {
  return Boolean(state?.viewer?.isDrawer && state.status === 'playing');
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function finishStroke() {
  if (!drawing || !currentStroke) {
    return;
  }
  drawing = false;
  if (currentStroke.points.length > 1) {
    socket.emit('draw:stroke', currentStroke);
  }
  currentStroke = null;
}

function redrawCanvas() {
  clearCanvas();
  for (const stroke of state.strokes ?? []) {
    drawStroke(stroke);
  }
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawStroke(stroke) {
  for (let index = 1; index < stroke.points.length; index += 1) {
    drawSegment(stroke.points[index - 1], stroke.points[index], stroke);
  }
}

function drawSegment(from, to, stroke) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function getOrCreatePlayerId() {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing) {
      return existing;
    }
    const next = createPlayerId();
    localStorage.setItem(PLAYER_ID_KEY, next);
    return next;
  } catch {
    return createPlayerId();
  }
}

function createPlayerId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
