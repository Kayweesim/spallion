import { db, toNum } from './_lib/db.js';
import { HttpError, handle, json } from './_lib/http.js';
import { isDayKey, todayKey } from '../src/game/session.js';

const LIMIT = 50;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * GET ?scope=daily[&day=YYYY-MM-DD] — one day's daily mission scores.
 * GET ?scope=all — total points across every daily mission played.
 * Send an x-player-id header to get your own row even if you're outside the top 50.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'daily';
  const pidParam = req.headers.get('x-player-id');
  const pid = pidParam && UUID.test(pidParam) ? pidParam.toLowerCase() : null;
  const sql = await db();

  if (scope === 'daily') {
    const day = url.searchParams.get('day') ?? todayKey();
    if (!isDayKey(day)) throw new HttpError(400, 'Invalid day');
    const ranked = `
      select p.name, s.score, s.player_id,
             rank() over (order by s.score desc) as rank
      from daily_scores s join players p on p.id = s.player_id
      where s.day = $1`;
    const top = await sql.query(`${ranked} order by s.score desc, s.created_at asc limit ${LIMIT}`, [day]);
    const [{ total }] = await sql.query(`select count(*) as total from daily_scores where day = $1`, [day]);
    const you = pid ? (await sql.query(`select * from (${ranked}) r where r.player_id = $2`, [day, pid]))[0] : undefined;
    return json({
      scope,
      day,
      total: toNum(total),
      entries: top.map((r) => ({ rank: toNum(r.rank), name: r.name, score: toNum(r.score), you: r.player_id === pid })),
      you: you ? { rank: toNum(you.rank), name: you.name, score: toNum(you.score) } : null,
    });
  }

  if (scope === 'all') {
    const ranked = `
      select p.name, s.player_id, sum(s.score) as score, count(*) as days, max(s.score) as best,
             rank() over (order by sum(s.score) desc) as rank
      from daily_scores s join players p on p.id = s.player_id
      group by s.player_id, p.name`;
    const top = await sql.query(`${ranked} order by score desc limit ${LIMIT}`);
    const [{ total }] = await sql.query(`select count(distinct player_id) as total from daily_scores`);
    const you = pid ? (await sql.query(`select * from (${ranked}) r where r.player_id = $1`, [pid]))[0] : undefined;
    const row = (r: Record<string, unknown>) => ({
      rank: toNum(r.rank), name: r.name, score: toNum(r.score), days: toNum(r.days), best: toNum(r.best),
    });
    return json({
      scope,
      total: toNum(total),
      entries: top.map((r) => ({ ...row(r), you: r.player_id === pid })),
      you: you ? row(you) : null,
    });
  }

  throw new HttpError(400, 'Unknown scope');
});
