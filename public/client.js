const socket = io();

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
const startBtn = document.querySelector('#startBtn');
const nextTurnBtn = document.querySelector('#nextTurnBtn');
const playerCount = document.querySelector('#playerCount');
const playerList = document.querySelector('#playerList');
const socketStatus = document.querySelector('#socketStatus');
const canvas = document.querySelector('#drawingCanvas');
const colorInput = document.querySelector('#colorInput');
const sizeInput = document.querySelector('#sizeInput');
const clearBtn = document.querySelector('#clearBtn');
const drawLock = document.querySelector('#drawLock');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const ctx = canvas.getContext('2d');

let state = null;
let drawing = false;
let currentStroke = null;

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

socket.on('connect', () => {
  socketStatus.textContent = '연결됨';
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
});

createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  requestRoom('room:create', { name });
});

entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();
  requestRoom('room:join', { name, code });
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
  socket.emit('chat:send', { message }, handleReply);
  chatInput.value = '';
});

canvas.addEventListener('pointerdown', (event) => {
  if (!canDraw()) {
    return;
  }
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  currentStroke = {
    color: colorInput.value,
    size: Number(sizeInput.value),
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
    entryView.classList.add('hidden');
    gameView.classList.remove('hidden');
    renderState();
  });
}

function handleReply(reply) {
  if (!reply?.ok && reply?.message) {
    showError(reply.message);
  }
}

function showError(message) {
  entryError.textContent = koreanError(message);
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
  roundText.textContent = state.status === 'waiting' ? '대기 중' : `${state.round}라운드`;

  if (!state.currentTurn) {
    wordText.textContent = '방장이 게임을 시작하세요';
  } else if (state.viewer.isDrawer) {
    wordText.textContent = `제시어: ${state.currentTurn.word}`;
  } else if (state.status === 'turn-ended') {
    wordText.textContent = `정답 완료: ${state.currentTurn.drawerName}의 차례`;
  } else {
    wordText.textContent = `${state.currentTurn.drawerName} 그림 | 힌트 ${state.currentTurn.hint}`;
  }

  startBtn.disabled = !state.viewer.isHost || state.status !== 'waiting' || state.players.length < 2;
  nextTurnBtn.disabled = !state.currentTurn || (!state.viewer.isDrawer && !state.viewer.isHost);
  clearBtn.disabled = !canDraw();
  drawLock.textContent = canDraw() ? '지금 그릴 차례입니다' : '그리는 차례가 아닙니다';
  chatInput.placeholder = state.viewer.isDrawer ? '그리는 사람은 채팅만 가능' : '정답 또는 채팅 입력';

  renderPlayers();
  renderMessages();
  redrawCanvas();
}

function renderPlayers() {
  playerList.innerHTML = '';
  for (const player of state.players) {
    const item = document.createElement('li');
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
  badge.textContent = text;
  return badge;
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
