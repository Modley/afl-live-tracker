// Mock/demo data source: a self-contained AFL match simulator.
//
// Useful when: there's no live AFL match in progress right now, you're
// developing offline, or you just want to see the fully-wired real-time
// pipeline (poll -> diff -> event -> WebSocket -> UI) working end to end
// without depending on an external API at all.
//
// It simulates a single match, ticking a real in-quarter clock every second
// and randomly scoring goals/behinds at realistic AFL-ish rates, running
// through 4 quarters plus breaks, then marking the game complete and
// starting a new one.

const TEAMS = [
  ['Richmond', 'Carlton'],
  ['Collingwood', 'Essendon'],
  ['Geelong', 'Hawthorn'],
  ['Sydney', 'GWS Giants'],
  ['Brisbane Lions', 'Fremantle'],
  ['West Coast', 'Port Adelaide'],
];

const QUARTER_LENGTH_SEC = 20 * 60; // simulated 20-minute quarters
const BREAK_LENGTH_SEC = 15; // short break between quarters for demo pacing

function randomTeams() {
  return TEAMS[Math.floor(Math.random() * TEAMS.length)];
}

function freshGame(id) {
  const [home, away] = randomTeams();
  return {
    id: `mock-${id}`,
    year: new Date().getFullYear(),
    round: 1,
    roundName: 'Round 1 (simulated)',
    venue: 'Demo Oval',
    startTime: new Date().toISOString(),
    status: 'live',
    complete: 1,
    quarter: 1,
    _quarterSeconds: 0,
    _inBreak: false,
    timeStr: 'Q1 0:00',
    home: { team: home, teamId: null, score: 0, goals: 0, behinds: 0 },
    away: { team: away, teamId: null, score: 0, goals: 0, behinds: 0 },
    winner: null,
    raw: { simulated: true },
  };
}

class MockSource {
  constructor() {
    this._counter = 0;
    this.game = freshGame(this._counter);
  }

  // Advance the simulation by `seconds` of match time and return the
  // current game state, matching the shape squiggle.js produces.
  tick(seconds = 1) {
    const g = this.game;

    if (g.status === 'complete') {
      // Start a new simulated match a few seconds after the last one ends.
      this._counter += 1;
      this.game = freshGame(this._counter);
      return { ...this.game };
    }

    if (g._inBreak) {
      g._quarterSeconds += seconds;
      if (g._quarterSeconds >= BREAK_LENGTH_SEC) {
        g._inBreak = false;
        g._quarterSeconds = 0;
        g.quarter += 1;
        if (g.quarter > 4) {
          g.status = 'complete';
          g.complete = 100;
          g.timeStr = 'Final';
          g.winner = g.home.score >= g.away.score ? g.home.team : g.away.team;
          return { ...g };
        }
      }
      g.timeStr = `Break (Q${g.quarter} starts in ${Math.max(0, BREAK_LENGTH_SEC - g._quarterSeconds)}s)`;
      g.complete = Math.min(99, Math.round(((g.quarter - 1) / 4) * 100));
      return { ...g };
    }

    g._quarterSeconds += seconds;

    // Random scoring: roughly one score event every ~35 simulated seconds.
    if (Math.random() < seconds / 35) {
      const scoringTeam = Math.random() < 0.5 ? g.home : g.away;
      const isGoal = Math.random() < 0.55; // goals slightly more common than behinds
      if (isGoal) {
        scoringTeam.goals += 1;
      } else {
        scoringTeam.behinds += 1;
      }
      scoringTeam.score = scoringTeam.goals * 6 + scoringTeam.behinds;
    }

    const mm = Math.floor(g._quarterSeconds / 60);
    const ss = String(g._quarterSeconds % 60).padStart(2, '0');
    g.timeStr = `Q${g.quarter} ${mm}:${ss}`;
    g.complete = Math.min(99, Math.round((((g.quarter - 1) * QUARTER_LENGTH_SEC + g._quarterSeconds) / (4 * QUARTER_LENGTH_SEC)) * 100));
    g.status = 'live';

    if (g._quarterSeconds >= QUARTER_LENGTH_SEC) {
      g._inBreak = true;
      g._quarterSeconds = 0;
    }

    return { ...g };
  }
}

module.exports = { MockSource };
