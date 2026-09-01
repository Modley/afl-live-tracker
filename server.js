require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const squiggle = require('./sources/squiggle');
const { MockSource } = require('./sources/mock');
const { diffGame } = require('./eventEngine');

const PORT = process.env.PORT || 4000;
const DATA_SOURCE = (process.env.DATA_SOURCE || 'squiggle').toLowerCase();
const POLL_INTERVAL_MS = Math.max(10000, Number(process.env.POLL_INTERVAL_MS) || 15000);
const SQUIGGLE_USER_AGENT = process.env.SQUIGGLE_USER_AGENT || 'afl-live-tracker (contact: unset@example.com)';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') },
});

// ---- In-memory state -------------------------------------------------
// gameId -> { game, events: [...], lastPollAt: ISOString, clockAnchor }
const store = new Map();
let lastSourceError = null;
let lastPollAt = null;

const mockSource = new MockSource();

function upsertGame(nextGame) {
  const existing = store.get(nextGame.id);
  const prevGame = existing ? existing.game : null;
  const newEvents = diffGame(prevGame, nextGame);

  const events = existing ? existing.events.concat(newEvents) : newEvents;
  // Keep event log bounded per game.
  const trimmedEvents = events.slice(-200);

  store.set(nextGame.id, {
    game: nextGame,
    events: trimmedEvents,
    clockAnchor: {
      quarter: nextGame.quarter,
      timeStr: nextGame.timeStr,
      receivedAt: Date.now(),
    },
  });

  if (newEvents.length > 0) {
    io.to(`game:${nextGame.id}`).emit('events', { gameId: nextGame.id, events: newEvents });
    io.emit('events', { gameId: nextGame.id, events: newEvents }); // also broadcast globally for the game-list ticker
  }
  io.to(`game:${nextGame.id}`).emit('game_update', { game: nextGame });
  io.emit('game_list_update', publicGameList());
}

function publicGameList() {
  return Array.from(store.values()).map((entry) => entry.game);
}

// ---- Polling loop ------------------------------------------------------
async function pollOnce() {
  try {
    let games;
    if (DATA_SOURCE === 'mock') {
      games = [mockSource.tick(Math.round(POLL_INTERVAL_MS / 1000))];
    } else {
      games = await squiggle.fetchLiveGames(SQUIGGLE_USER_AGENT);
    }
    lastSourceError = null;
    lastPollAt = new Date().toISOString();

    for (const g of games) {
      upsertGame(g);
    }

    // Mark games that were live last poll but are no longer in the live list
    // as complete (Squiggle's live=true list simply drops finished games).
    if (DATA_SOURCE !== 'mock') {
      const stillLiveIds = new Set(games.map((g) => g.id));
      for (const [id, entry] of store.entries()) {
        if (entry.game.status === 'live' && !stillLiveIds.has(id)) {
          const completedGame = { ...entry.game, status: 'complete', complete: 100 };
          upsertGame(completedGame);
        }
      }
    }

    io.emit('source_status', { ok: true, lastPollAt, dataSource: DATA_SOURCE });
  } catch (err) {
    lastSourceError = err.message;
    console.error(`[poll] ${DATA_SOURCE} fetch failed:`, err.message);
    io.emit('source_status', { ok: false, error: err.message, lastPollAt, dataSource: DATA_SOURCE });
  }
}

// ---- Per-second local clock tick ---------------------------------------
// Between polls we don't have fresh score data, but we can still give the
// UI a genuinely live, ticking clock by interpolating elapsed time since
// the last poll. This is what makes the experience feel "wired" every
// second even though the underlying score source only refreshes every
// POLL_INTERVAL_MS.
function tickClocks() {
  for (const entry of store.values()) {
    if (entry.game.status !== 'live') continue;
    const elapsedSec = Math.floor((Date.now() - entry.clockAnchor.receivedAt) / 1000);
    io.to(`game:${entry.game.id}`).emit('clock_tick', {
      gameId: entry.game.id,
      quarter: entry.clockAnchor.quarter,
      baseTimeStr: entry.clockAnchor.timeStr,
      elapsedSecSincePoll: elapsedSec,
      serverTime: new Date().toISOString(),
    });
  }
}

// ---- REST API ------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    dataSource: DATA_SOURCE,
    pollIntervalMs: POLL_INTERVAL_MS,
    lastPollAt,
    lastSourceError,
    gamesTracked: store.size,
  });
});

app.get('/api/games', (req, res) => {
  res.json({ games: publicGameList(), lastPollAt, dataSource: DATA_SOURCE });
});

app.get('/api/games/:id', (req, res) => {
  const entry = store.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Game not found (not currently tracked)' });
  res.json({ game: entry.game, events: entry.events });
});

// Serve the frontend as static files so the whole thing can run as one process.
app.use(express.static(require('path').join(__dirname, '..', 'frontend')));

// ---- WebSocket wiring ------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('game_list_update', publicGameList());
  socket.emit('source_status', { ok: !lastSourceError, error: lastSourceError, lastPollAt, dataSource: DATA_SOURCE });

  socket.on('subscribe', (gameId) => {
    socket.join(`game:${gameId}`);
    const entry = store.get(gameId);
    if (entry) {
      socket.emit('game_update', { game: entry.game });
      socket.emit('events', { gameId, events: entry.events });
    }
  });

  socket.on('unsubscribe', (gameId) => {
    socket.leave(`game:${gameId}`);
  });
});

// ---- Start ------------------------------------------------------------
pollOnce();
setInterval(pollOnce, POLL_INTERVAL_MS);
setInterval(tickClocks, 1000);

server.listen(PORT, () => {
  console.log(`AFL live tracker backend listening on http://localhost:${PORT}`);
  console.log(`Data source: ${DATA_SOURCE} | poll interval: ${POLL_INTERVAL_MS}ms`);
});
