import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './game/roomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

export function createServerApp() {
  const expressApp = express();
  const httpServer = http.createServer(expressApp);
  const io = new Server(httpServer);
  const roomManager = new RoomManager();
  const socketRooms = new Map();
  const turnTimers = new Map();

  expressApp.get('/healthz', (_request, response) => {
    response.status(200).json({ ok: true, service: 'catchmind-web' });
  });

  expressApp.use(express.static(publicDir));

  io.on('connection', (socket) => {
    const sendError = (message) => socket.emit('app:error', { message });

    const emitRoom = (code) => {
      const roomCode = String(code ?? '').toUpperCase();
      const room = roomManager.rooms.get(roomCode);
      if (!room) {
        return;
      }

      for (const player of room.players) {
        io.to(player.socketId).emit('room:state', roomManager.getSnapshotForSocket({
          code: roomCode,
          viewerSocketId: player.socketId
        }));
      }
    };

    const clearTurnTimer = (code) => {
      const roomCode = String(code ?? '').toUpperCase();
      const timer = turnTimers.get(roomCode);
      if (timer) {
        clearTimeout(timer);
        turnTimers.delete(roomCode);
      }
    };

    const scheduleTurnTimer = (code) => {
      const roomCode = String(code ?? '').toUpperCase();
      const room = roomManager.rooms.get(roomCode);
      clearTurnTimer(roomCode);
      if (!room?.currentTurn || room.status !== 'playing') {
        return;
      }

      const delay = Math.max(0, room.currentTurn.endsAt - Date.now());
      const timer = setTimeout(() => {
        const result = roomManager.expireTurn({ code: roomCode });
        turnTimers.delete(roomCode);
        if (result.expired) {
          emitRoom(roomCode);
        }
      }, delay);
      turnTimers.set(roomCode, timer);
    };

    const attachSocketToRoom = ({ code, name, playerId }) => {
      const snapshot = roomManager.joinRoom({
        code: String(code ?? '').trim().toUpperCase(),
        socketId: socket.id,
        name,
        playerId
      });
      socket.join(snapshot.code);
      socketRooms.set(socket.id, snapshot.code);
      return snapshot;
    };

    socket.on('room:create', ({ name, playerId }, reply) => {
      try {
        const snapshot = roomManager.createRoom({ socketId: socket.id, name, playerId });
        socket.join(snapshot.code);
        socketRooms.set(socket.id, snapshot.code);
        reply?.({ ok: true, snapshot });
        emitRoom(snapshot.code);
      } catch (error) {
        reply?.({ ok: false, message: error.message });
        sendError(error.message);
      }
    });

    socket.on('room:join', ({ code, name, playerId }, reply) => {
      try {
        const snapshot = attachSocketToRoom({ code, name, playerId });
        reply?.({ ok: true, snapshot });
        emitRoom(snapshot.code);
      } catch (error) {
        reply?.({ ok: false, message: error.message });
        sendError(error.message);
      }
    });

    socket.on('game:start', (reply) => {
      try {
        const code = socketRooms.get(socket.id);
        const snapshot = roomManager.startGame({ code, socketId: socket.id, viewerSocketId: socket.id });
        reply?.({ ok: true, snapshot });
        scheduleTurnTimer(code);
        emitRoom(code);
      } catch (error) {
        reply?.({ ok: false, message: error.message });
        sendError(error.message);
      }
    });

    socket.on('draw:stroke', (stroke) => {
      try {
        const code = socketRooms.get(socket.id);
        const normalized = roomManager.addStroke({ code, socketId: socket.id, stroke });
        socket.to(code).emit('draw:stroke', normalized);
      } catch (error) {
        sendError(error.message);
      }
    });

    socket.on('draw:clear', () => {
      try {
        const code = socketRooms.get(socket.id);
        roomManager.clearCanvas({ code, socketId: socket.id });
        io.to(code).emit('draw:clear');
        emitRoom(code);
      } catch (error) {
        sendError(error.message);
      }
    });

    socket.on('chat:send', ({ message, code: payloadCode, name, playerId }, reply) => {
      try {
        let code = socketRooms.get(socket.id);
        if (!code && payloadCode) {
          const snapshot = attachSocketToRoom({ code: payloadCode, name, playerId });
          code = snapshot.code;
        }
        const result = roomManager.submitChat({ code, socketId: socket.id, message });
        reply?.({ ok: true, correct: result.correct });
        io.to(code).emit('chat:message', result.chat);
        if (result.correct) {
          clearTurnTimer(code);
        }
        emitRoom(code);
      } catch (error) {
        reply?.({ ok: false, message: error.message });
        sendError(error.message);
      }
    });

    socket.on('turn:next', (reply) => {
      try {
        const code = socketRooms.get(socket.id);
        const snapshot = roomManager.nextTurn({ code, socketId: socket.id, viewerSocketId: socket.id });
        io.to(code).emit('draw:clear');
        reply?.({ ok: true, snapshot });
        scheduleTurnTimer(code);
        emitRoom(code);
      } catch (error) {
        reply?.({ ok: false, message: error.message });
        sendError(error.message);
      }
    });

    socket.on('disconnect', () => {
      const removed = roomManager.removePlayer(socket.id);
      const code = socketRooms.get(socket.id) ?? removed?.code;
      socketRooms.delete(socket.id);
      if (code && !removed?.deleted) {
        scheduleTurnTimer(code);
        emitRoom(code);
      } else if (code) {
        clearTurnTimer(code);
      }
    });
  });

  return { expressApp, httpServer, io, roomManager };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const { httpServer } = createServerApp();
  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, () => {
    console.log(`Catchmind server listening on http://localhost:${port}`);
  });
}
