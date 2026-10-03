import { db, toNum } from './_lib/db.js';
import { HttpError, callsign, handle, json, playerId, readJson } from './_lib/http.js';
import { TIERS } from '../src/game/data.js';
import { matchAnswer } from '../src/game/match.js';
import { dailyPrompts, isDayKey, todayKey, yesterdayKey } from '../src/game/session.js';

/**
 * POST a finished daily mission. The server re-scores the raw guesses itself,
 * so the leaderboard never trusts client-side points. One entry per player per day.
 */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const id = playerId(body.playerId);
  const name = callsign(body.name);
  const day = body.day;
  if (!isDayKey(day) || (day !== todayKey() && day !== yesterdayKey())) {
    throw new HttpError(400, 'That daily mission is closed');
  }
  const prompts = dailyPrompts(day);
  const guesses = body.guesses;
  if (!Array.isArray(guesses) || guesses.length !== prompts.length) throw new HttpError(400, 'Expected one guess per prompt');

  const rounds = prompts.map((p, i) => {
    const guess = typeof guesses[i] === 'string' ? (guesses[i] as string).slice(0, 80) : null;
    const m = guess ? matchAnswer(p, guess) : null;
    return { promptId: p.id, guess, tier: m?.tier ?? null, points: m ? TIERS[m.tier].points : 0 };
  });
  const score = rounds.reduce((n, r) => n + r.points, 0);

  const sql = await db();
  await sql.query(
    `insert into players (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name`,
    [id, name],
  );
  const inserted = await sql.query(
    `insert into daily_scores (player_id, day, score, rounds) values ($1, $2, $3, $4)
     on conflict (player_id, day) do nothing returning score`,
    [id, day, score, JSON.stringify(rounds)],
  );
  const [mine] = await sql.query(`select score from daily_scores where player_id = $1 and day = $2`, [id, day]);
  const finalScore = toNum(mine?.score);
  const [rank] = await sql.query(
    `select count(*) filter (where score > $2) + 1 as rank, count(*) as total from daily_scores where day = $1`,
    [day, finalScore],
  );
  return json({
    score: finalScore,
    rank: toNum(rank.rank),
    total: toNum(rank.total),
    alreadySubmitted: inserted.length === 0,
  });
});
