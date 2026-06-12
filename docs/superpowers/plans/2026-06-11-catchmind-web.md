# Catchmind Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable realtime web Catchmind game for up to 4 players, with an easy path to 8 players later.

**Architecture:** Express serves a static browser client. Socket.IO synchronizes room state and drawing events. Pure game logic lives in `src/game/roomManager.js` so tests can exercise rules without sockets.

**Tech Stack:** Node.js, Express, Socket.IO, Node test runner, HTML Canvas, vanilla CSS and JavaScript.

---

## File Structure

- `package.json`: scripts and dependencies.
- `src/game/roomManager.js`: pure room, player, turn, scoring, and validation logic.
- `src/server.js`: Express and Socket.IO adapter around the room manager.
- `public/index.html`: game shell.
- `public/styles.css`: responsive game UI.
- `public/client.js`: browser socket, canvas, chat, and state rendering.
- `test/roomManager.test.js`: core game rule tests.

## Tasks

### Task 1: Project Scaffold

- [ ] Create `package.json` with `start`, `dev`, and `test` scripts.
- [ ] Install `express` and `socket.io`.
- [ ] Create source, public, and test directories.

### Task 2: Room Logic with TDD

- [ ] Write tests for room creation, 4-player limit, 8-player expansion constants, drawer-only drawing, correct guesses, scoring, and turn rotation in `test/roomManager.test.js`.
- [ ] Run `npm test` and confirm the tests fail because `src/game/roomManager.js` is missing.
- [ ] Implement `src/game/roomManager.js` with a `RoomManager` class and exported constants.
- [ ] Run `npm test` and confirm all room logic tests pass.

### Task 3: Socket Server

- [ ] Create `src/server.js` to serve `public` and bind Socket.IO events to the room manager.
- [ ] Add events: `room:create`, `room:join`, `game:start`, `draw:stroke`, `draw:clear`, `chat:send`, `turn:next`, and disconnect handling.
- [ ] Run `npm test` again after wiring the server import path.

### Task 4: Browser Client

- [ ] Create `public/index.html`, `public/styles.css`, and `public/client.js`.
- [ ] Build the entry view, game view, canvas drawing, tool controls, player list, status strip, and chat.
- [ ] Render disabled states when the current player is not the drawer.

### Task 5: Verification

- [ ] Run `npm test`.
- [ ] Start the server with `npm start`.
- [ ] Open `http://localhost:3000` and verify the page loads.
- [ ] Check that the client bundle has no obvious runtime syntax errors.
