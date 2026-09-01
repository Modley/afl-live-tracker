# AFL Live Tracker

A fully wired, real-time AFL score tracking app: a Node backend polls a live
scores source, diffs each update into discrete events (goals, behinds,
quarter changes, full time), and pushes them instantly over WebSocket to a
live-updating dashboard — including a genuinely ticking, per-second match
clock.

```
┌────────────┐   poll every ~15s   ┌────────────────┐   WebSocket (instant)   ┌───────────┐
│ Squiggle API│ ───────────────────▶│  Node backend   │────────────────────────▶│  Browser  │
│ (or mock)  │                     │ (poll, diff,    │   + 1x/sec clock tick   │ dashboard │
└────────────┘                     │  event engine)  │────────────────────────▶│           │
                                    └────────────────┘                          └───────────┘
```

## Important: what "fully live" means here, honestly

There is no free public source of true second-by-second AFL play-by-play
(every tackle, possession, etc.) — that data is proprietary to Champion Data
and licensed commercially to broadcasters/apps at real cost. Scraping the
official AFL website's live match centre directly is against its terms of
use and breaks constantly since it's not a stable API.

So this app is built on **[Squiggle](https://api.squiggle.com.au)**, a free,
public, hobby-run AFL API that Australia's stats/tipping community has used
for years. Squiggle gives you the score state (goals, behinds, total score,
quarter, time-in-quarter) and its own scrapers typically refresh that data
every 15–60 seconds during a live match. That refresh rate — not "every
second" — is the practical ceiling for a free source.

To still make the *experience* feel fully live, the backend runs a
per-second clock loop that interpolates the time-in-quarter between polls
and pushes a `clock_tick` over WebSocket every second, so the on-screen
clock counts up smoothly in real time even though scores only change when
new data actually arrives. When a score does change, it reaches every
connected browser instantly (no polling on the frontend at all).

If you have access to a paid feed (Sportradar, Champion Data, SportsDataIO,
etc.) that provides true play-by-play, swap it in — see "Adding a real
paid data source" below. The architecture (poll/stream → diff → event →
WebSocket) doesn't change, only `backend/sources/*.js` does.

## What's included

- **`backend/server.js`** — Express + Socket.IO server. Polls the data
  source on an interval, maintains in-memory state per game, emits:
  - `game_list_update` — full list of tracked games
  - `game_update` — latest state for one game
  - `events` — newly detected events (goal/behind/quarter/full-time)
  - `clock_tick` — once per second, interpolated match clock
  - `source_status` — whether the last poll succeeded
- **`backend/sources/squiggle.js`** — real adapter for the Squiggle API.
- **`backend/sources/mock.js`** — a self-contained match simulator (ticking
  clock, realistic-ish random scoring) so you can see the whole pipeline
  working without any external dependency — useful for development, demos,
  or the off-season.
- **`backend/eventEngine.js`** — turns two successive score snapshots into
  a list of human-readable events.
- **`frontend/index.html`** — single-page dashboard: game list, big
  scoreboard, live ticking clock, and a live commentary/event feed. No
  build step, no framework — plain JS + the Socket.IO client, served
  directly by the backend.
- REST API (`/api/health`, `/api/games`, `/api/games/:id`) if you want to
  build another frontend or hit it from a script.

## Running it locally

Requires Node 18+.

```bash
cd backend
npm install
cp .env.example .env
```

Then either:

**Try it instantly with simulated data** (no external network needed) — set
in `.env`:
```
DATA_SOURCE=mock
```

**Or point it at real live AFL data** — set in `.env`:
```
DATA_SOURCE=squiggle
SQUIGGLE_USER_AGENT=your-app-name (contact: your-email@example.com)
```
Squiggle explicitly asks API consumers to identify themselves with a
descriptive User-Agent — please fill in something real before deploying
this anywhere public, and don't lower `POLL_INTERVAL_MS` below 10 seconds;
their live-scores refresh rate means anything faster just wastes requests
against a free community-run service.

Then:
```bash
npm start
```

Open **http://localhost:4000** — the backend serves the frontend directly,
so that's the only URL you need. Click a game in the left panel to see its
live scoreboard and event feed.

> Note: when using `DATA_SOURCE=squiggle`, games only appear once Squiggle
> reports them as live (mid-match). Outside of live match windows the list
> will be empty — that's expected, not a bug. Switch to `DATA_SOURCE=mock`
> any time to see a full match play out in a couple of minutes for testing.

## Deploying it as a real web app (step by step)

This is a single Node process (it serves both the API/WebSocket and the
static frontend), so it deploys anywhere that runs Node. These steps use
**Render** because its free tier needs no credit card and supports
WebSockets out of the box; Railway or Fly.io work the same way if you'd
rather use one of those.

**1. Put the code on GitHub** (Render deploys from a repo, not a zip upload):

```bash
# from inside the unzipped afl-live-tracker folder
git init                       # skip if it's already a git repo
git add -A
git commit -m "AFL live tracker"
```

Then create a new empty repo at github.com/new (call it `afl-live-tracker`,
don't add a README/license there), and push:

```bash
git remote add origin https://github.com/<your-username>/afl-live-tracker.git
git branch -M main
git push -u origin main
```

**2. Create a Render account** at render.com (free, GitHub sign-in is
fastest) and connect your GitHub account when it asks.

**3. Deploy the blueprint** — the repo already includes a `render.yaml` that
does the field-filling for you:
- Dashboard → **New +** → **Blueprint**
- Pick your `afl-live-tracker` repo → Render reads `render.yaml` and shows
  one service, `afl-live-tracker`, pre-filled with the right root directory
  (`backend`), build command (`npm install`) and start command (`npm start`)
- Before clicking Apply, open the `SQUIGGLE_USER_AGENT` env var it shows and
  replace the placeholder with something identifying your app + a real
  contact email — Squiggle's API asks for this
- Click **Apply** / **Create Web Service**

**4. Wait for the first build** (1-2 minutes) — Render shows live build
logs. Once it says "Live", your app is running at a URL Render gives you,
like `https://afl-live-tracker.onrender.com`. Open it — that's the web app.

**5. Bookmark and share that URL.** Anyone who opens it sees the same live
dashboard, updating in real time together, no install required.

Notes on the free tier:
- It **spins down after ~15 minutes with no visitors** and takes ~30-60
  seconds to wake back up on the next visit (a cold start) — fine for
  checking scores on matchday, less fine if you want it always instantly
  warm. Render's paid "Starter" tier ($7/mo) removes the sleep.
- Games only appear in the list once Squiggle reports them as actually
  live (mid-match) — outside live windows the dashboard will correctly show
  an empty list, not a bug.
- To update the app later: edit the code, `git add -A && git commit -m "..."
  && git push` — Render redeploys automatically on every push to `main`.

Whichever host you use, the general requirements are the same:
- Set the environment variables from `.env.example` in your host's config.
- Expose `PORT` (most platforms inject this automatically — the app already
  reads `process.env.PORT`).
- WebSocket support must be enabled on your host (Socket.IO falls back to
  HTTP long-polling automatically if raw WebSockets aren't available, so it
  still works either way, just less efficiently).
- Squiggle's API has no official uptime SLA (it's a free hobby project) —
  the backend already treats a failed poll as non-fatal (logs it, reports
  `source_status: {ok:false}` to clients, and keeps retrying next interval)
  rather than crashing, but plan for occasional gaps.

## Adding a real paid data source (true play-by-play)

If you get access to a commercial feed with real play-by-play (Sportradar,
Champion Data, SportsDataIO, Genius Sports, etc.):

1. Create `backend/sources/yourprovider.js` exporting the same shape as
   `squiggle.js` (`fetchLiveGames(...)` returning normalized game objects —
   see the shape documented at the top of `squiggle.js`).
2. Many paid feeds push updates via WebSocket/webhook rather than needing
   you to poll — if so, replace the `setInterval(pollOnce, ...)` loop in
   `server.js` with your provider's push subscription calling `upsertGame()`
   directly whenever an update arrives. That gets you genuinely sub-second
   updates, since the diff/event/broadcast pipeline is already push-based
   from that point on.
3. Extend `eventEngine.js` to turn the extra play-by-play fields your feed
   provides (tackles, inside 50s, disposals, etc.) into more event types.

## Project layout

```
afl-live-tracker/
├── README.md
├── render.yaml            # Render Blueprint - one-click deploy config
├── backend/
│   ├── server.js         # Express + Socket.IO server, polling loop, per-second clock
│   ├── eventEngine.js     # score-snapshot diffing → events
│   ├── sources/
│   │   ├── squiggle.js    # real public API adapter
│   │   └── mock.js        # offline match simulator
│   ├── package.json
│   └── .env.example
└── frontend/
    └── index.html         # single-page live dashboard (no build step)
```
