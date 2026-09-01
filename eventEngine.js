// Turns successive score snapshots for a game into a discrete event log:
// goals, behinds, quarter changes, and full-time. This is what lets the
// frontend show a live "commentary" feed instead of just a number that
// changes.

function diffGame(prevGame, nextGame) {
  const events = [];
  if (!prevGame) {
    if (nextGame.status !== 'scheduled') {
      events.push(mkEvent(nextGame, 'game_start', `${nextGame.home.team} vs ${nextGame.away.team} is underway`));
    }
    return events;
  }

  // Quarter change
  if (prevGame.quarter !== nextGame.quarter && nextGame.quarter != null) {
    events.push(mkEvent(nextGame, 'quarter_change', `Start of Q${nextGame.quarter}`));
  }

  // Score changes, attributed to whichever side's goals/behinds went up.
  diffSide(prevGame, nextGame, 'home', events);
  diffSide(prevGame, nextGame, 'away', events);

  // Full time
  if (prevGame.status !== 'complete' && nextGame.status === 'complete') {
    const margin = Math.abs(nextGame.home.score - nextGame.away.score);
    const resultText = nextGame.winner
      ? `Final siren: ${nextGame.winner} wins by ${margin}`
      : `Final siren: scores level at ${nextGame.home.score}-${nextGame.away.score}`;
    events.push(mkEvent(nextGame, 'full_time', resultText));
  }

  return events;
}

function diffSide(prev, next, side, events) {
  const p = prev[side];
  const n = next[side];
  if (p == null || n == null) return;

  const goalsUp = numOr(n.goals) - numOr(p.goals);
  const behindsUp = numOr(n.behinds) - numOr(p.behinds);

  for (let i = 0; i < goalsUp; i++) {
    events.push(mkEvent(next, 'goal', `GOAL ${n.team}!`, side));
  }
  for (let i = 0; i < behindsUp; i++) {
    events.push(mkEvent(next, 'behind', `Behind, ${n.team}`, side));
  }
}

function numOr(v) {
  return Number.isFinite(v) ? v : 0;
}

function mkEvent(game, type, text, side) {
  return {
    id: `${game.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gameId: game.id,
    type,
    side: side || null,
    text,
    quarter: game.quarter,
    timeStr: game.timeStr,
    scoreSnapshot: { home: game.home.score, away: game.away.score },
    at: new Date().toISOString(),
  };
}

module.exports = { diffGame };
