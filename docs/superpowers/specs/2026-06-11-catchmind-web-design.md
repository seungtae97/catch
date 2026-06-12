# Catchmind Web Design

## Goal

Build a browser-based Catchmind game where up to 4 players can join the same room now, while keeping the room model, event payloads, and UI layout ready for an 8-player cap later.

## Approach

Use a Node.js Express server with Socket.IO for realtime rooms. The server owns all game state: rooms, players, turns, words, scores, drawing strokes, chat, guesses, and round progress. Browsers render state from server snapshots and send intent events such as join room, draw stroke, send guess, clear canvas, and next turn.

## Game Flow

- A player creates or joins a room using a short room code.
- Up to 4 players may join in version 1. The configuration keeps `MAX_PLAYERS` separate from `EXPANSION_MAX_PLAYERS = 8`.
- The drawer sees the secret word. Guessers see only the word length hint.
- Drawing events stream to everyone in the room.
- Guess messages are checked by the server. A correct guess awards points to the guesser and drawer, ends the turn, and enables the next turn.
- If nobody guesses, the drawer or host can skip to the next turn.
- Turns rotate through connected players. Scores persist within the room while players remain connected.

## UI

The first screen is the actual game entry, not a landing page. The game screen uses a large canvas, compact room/player/score panels, chat and guess input, drawing tools for the active drawer, and clear disabled states for spectators or guessers.

## Error Handling

The server rejects full rooms, invalid names, missing rooms, duplicate joins, and drawing attempts from non-drawers. Clients show concise inline messages and reconnect to the latest room snapshot when possible.

## Testing

Core room and game rules are covered with Node's built-in test runner before implementation. Browser behavior is verified by starting the app locally and opening it in a browser.
