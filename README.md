# Catchmind Web

Realtime browser Catchmind game for up to 4 players. The server state is structured so the player cap can later be raised toward 8 players by changing the room limit and reviewing the UI layout.

## Local Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Tests

```bash
npm test
```

## Deploy on Render

This app uses Socket.IO, so deploy it as a Node web service instead of a static site or serverless function.

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Render will read `render.yaml` from the repository root.
4. Confirm the service:
   - Runtime: Node
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/healthz`
5. After deploy finishes, open the Render URL and share it with players.

Render's free web service can sleep after inactivity. For smoother game sessions, switch the service plan from `free` to a paid always-on instance before inviting a group.

## Notes

- Rooms and scores are in memory. A deploy restart clears active rooms.
- Running more than one server instance needs shared state, such as Redis plus Socket.IO adapter.
- The client connects to the same origin that serves the page, so no extra Socket.IO URL setting is needed for Render.
