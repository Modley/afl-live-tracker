// Squiggle AFL API adapter.
//
// Squiggle (https://api.squiggle.com.au) is a free, public AFL data API run
// as a hobby project. It is NOT an official/paid feed and does NOT provide
// play-by-play (tackles, possessions, etc.) - only periodic score state:
// goals, behinds, total score, quarter, and a time-in-quarter string. Their
// own scrapers typically refresh scores every 15-60 seconds during a live
// match, so this is the practical ceiling on "live-ness" for a free source.
//
// API etiquette (per Squiggle's docs): identify your app with a descriptive
// User-Agent, and don't poll harder than you need to (a few requests per
// minute is plenty). This adapter defaults to one request per POLL_INTERVAL_MS.
//
// NOTE: Squiggle's exact field names have shifted a little over the years.
// This adapter normalizes defensively - if Squiggle changes their schema,
// update the `normalizeGame` function below. Run `node backend/sources/squiggle.js`
// standalone to dump a raw sample response for inspection.

const fetch = require('node-fetch');

const BASE_URL = 'https://api.squiggle.com.au';

async function fetchJson(query, userAgent) {
  const url = `${BASE_URL}/?${query}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent || 'afl-live-tracker (contact: unset@example.com)',
      Accept: 'application/json',
    },
    timeout: 10000,
  });
  if (!res.ok) {
    throw new Error(`Squiggle API error ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

// Normalize a raw Squiggle game object into our internal shape.
// Defensive about field names since Squiggle's schema has minor variants
// across endpoints (games vs livescores).
function normalizeGame(raw) {
  const homeTeam = raw.hteam || raw.hometeam || raw.hteamAbbr || 'Home';
  const awayTeam = raw.ateam || raw.awayteam || raw.ateamAbbr || 'Away';

  const homeScore = numOr(raw.hscore, 0);
  const awayScore = numOr(raw.ascore, 0);
  const homeGoals = numOr(raw.hgoals, null);
  const homeBehinds = numOr(raw.hbehinds, null);
  const awayGoals = numOr(raw.agoals, null);
  const awayBehinds = numOr(raw.abehinds, null);

  // "complete" is 0-100 (% of match complete). 0 = not started, 100 = final.
  const complete = numOr(raw.complete, raw.iscomplete ? 100 : 0);
  const isComplete = complete >= 100;
  const isLive = complete > 0 && complete < 100;

  return {
    id: String(raw.id ?? raw.gameid ?? `${raw.year}-${raw.round}-${homeTeam}-${awayTeam}`),
    year: raw.year,
    round: raw.round,
    roundName: raw.roundname || (raw.round != null ? `Round ${raw.round}` : null),
    venue: raw.venue || null,
    startTime: raw.date || raw.localtime || null,
    status: isComplete ? 'complete' : isLive ? 'live' : 'scheduled',
    complete,
    quarter: raw.quarter ?? null, // 1-4 (or 5+ for extra time in finals)
    timeStr: raw.timestr || raw.updated || null, // e.g. "Q3 12:34" when live
    home: {
      team: homeTeam,
      teamId: raw.hteamid ?? null,
      score: homeScore,
      goals: homeGoals,
      behinds: homeBehinds,
    },
    away: {
      team: awayTeam,
      teamId: raw.ateamid ?? null,
      score: awayScore,
      goals: awayGoals,
      behinds: awayBehinds,
    },
    winner: raw.winner || null,
    raw, // keep the raw payload around for debugging / future fields
  };
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Fetch all live (in-progress) games "right now".
async function fetchLiveGames(userAgent) {
  // q=games;live=true is Squiggle's documented way to get in-progress games.
  const data = await fetchJson('q=games;live=true', userAgent);
  const games = data.games || [];
  return games.map(normalizeGame);
}

// Fetch games for a given round (useful for showing "today's fixtures" even
// when nothing is live yet, and for the mock/demo fallback logic).
async function fetchRoundGames(year, round, userAgent) {
  const q = round != null
    ? `q=games;year=${year};round=${round}`
    : `q=games;year=${year}`;
  const data = await fetchJson(q, userAgent);
  const games = data.games || [];
  return games.map(normalizeGame);
}

// Standalone debug mode: `node sources/squiggle.js` dumps a raw sample.
if (require.main === module) {
  (async () => {
    try {
      const ua = process.env.SQUIGGLE_USER_AGENT || 'afl-live-tracker (debug run)';
      console.log('Fetching live games from Squiggle...');
      const live = await fetchLiveGames(ua);
      console.log(JSON.stringify(live, null, 2));
      if (live.length === 0) {
        console.log('\nNo live games right now. Try fetchRoundGames for a completed round instead.');
      }
    } catch (err) {
      console.error('Squiggle fetch failed:', err.message);
      process.exitCode = 1;
    }
  })();
}

module.exports = { fetchLiveGames, fetchRoundGames, normalizeGame };
