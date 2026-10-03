import { db, toMs, toNum, type Db } from './_lib/db.js';
import { HttpError, callsign, handle, json, playerId, readJson } from './_lib/http.js';
import { TIERS, getPrompt } from '../src/game/data.js';
import { matchAnswer } from '../src/game/match.js';
import { MP, ROOM_CODE_ALPHABET, isRoomCode, phaseAt, revealedRounds, type RoomState } from '../src/game/multiplayer.js';
import { pickPrompts } from '../src/game/session.js';
import type { TierId } from '../src/game/types.js';

const ROOM_TTL = `interval '6 hours'`;

interface Room {
  code: string;
  hostId: string;
  promptIds: string[];
  startAt: number | null;
}

async function loadRoom(sql: Db, code: unknown): Promise<Room> {
  if (!isRoomCode(code)) throw new HttpError(400, 'Room codes are 5 letters/numbers');
  const [r] = await sql.query(
    `select code, host_id, prompt_ids, start_at from rooms where code = $1 and created_at > now() - ${ROOM_TTL}`,
    [code],
  );
  if (!r) throw new HttpError(404, 'No room with that code');
  return { code: r.code as string, hostId: r.host_id as string, promptIds: (r.prompt_ids as string).split(','), startAt: toMs(r.start_at) };
}

async function roomState(sql: Db, room: Room, me: string | null): Promise<RoomState> {
  const now = Date.now();
  const phase = phaseAt(room.startAt, now);
  const revealed = revealedRounds(phase);
  const current = phase.kind === 'ask' ? phase.round : -1;

  const players = await sql.query(
    `select player_id, name from room_players where code = $1 order by joined_at, player_id`,
    [room.code],
  );
  const answers = await sql.query(
    `select player_id, round, matched, tier, points from room_answers where code = $1 order by round`,
    [room.code],
  );

  const slotOf = new Map(players.map((p, i) => [p.player_id as string, i]));
  const nameOf = new Map(players.map((p) => [p.player_id as string, p.name as string]));
  const score = new Map<string, number>();
  const answeredCurrent = new Set<string>();
  const byRound: RoomState['answers'] = Array.from({ length: revealed }, () => []);
  let yourCurrent: RoomState['yourCurrent'] = null;

  for (const a of answers) {
    const pid = a.player_id as string;
    const round = toNum(a.round);
    if (round < revealed) {
      score.set(pid, (score.get(pid) ?? 0) + toNum(a.points));
      byRound[round].push({
        slot: slotOf.get(pid) ?? -1,
        name: nameOf.get(pid) ?? '???',
        matched: a.matched as string,
        tier: a.tier as TierId,
        points: toNum(a.points),
      });
    } else if (round === current) {
      answeredCurrent.add(pid);
      if (pid === me) yourCurrent = { round, matched: a.matched as string, tier: a.tier as TierId, points: toNum(a.points) };
    }
  }
  for (const list of byRound) list.sort((x, y) => y.points - x.points || x.slot - y.slot);

  return {
    code: room.code,
    promptIds: room.promptIds,
    startAt: room.startAt,
    serverNow: now,
    youAreIn: me !== null && slotOf.has(me),
    players: players.map((p, i) => {
      const pid = p.player_id as string;
      return {
        slot: i,
        name: p.name as string,
        you: pid === me,
        host: pid === room.hostId,
        score: score.get(pid) ?? 0,
        answeredCurrent: answeredCurrent.has(pid),
      };
    }),
    answers: byRound,
    yourCurrent,
  };
}

function newCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return code;
}

/** GET ?code=ABCDE (+ x-player-id header) — the room as this player sees it. */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const sql = await db();
  const room = await loadRoom(sql, url.searchParams.get('code'));
  const pid = req.headers.get('x-player-id');
  return json(await roomState(sql, room, pid ? playerId(pid) : null));
});

/** POST { action: 'create' | 'join' | 'start' | 'answer', ... } */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const me = playerId(body.playerId);
  const sql = await db();

  switch (body.action) {
    case 'create': {
      const name = callsign(body.name);
      await sql.query(`delete from rooms where created_at < now() - interval '1 day'`);
      const promptIds = pickPrompts('unlimited').map((p) => p.id).join(',');
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const made = await sql.query(
          `insert into rooms (code, host_id, prompt_ids) values ($1, $2, $3) on conflict (code) do nothing returning code`,
          [code, me, promptIds],
        );
        if (made.length) {
          await sql.query(`insert into room_players (code, player_id, name) values ($1, $2, $3)`, [code, me, name]);
          return json(await roomState(sql, await loadRoom(sql, code), me), 201);
        }
      }
      throw new HttpError(503, 'Could not allocate a room code, try again');
    }

    case 'join': {
      const name = callsign(body.name);
      const room = await loadRoom(sql, body.code);
      const [already] = await sql.query(`select 1 from room_players where code = $1 and player_id = $2`, [room.code, me]);
      if (!already) {
        if (room.startAt !== null) throw new HttpError(409, 'That mission has already launched');
        const [{ n }] = await sql.query(`select count(*) as n from room_players where code = $1`, [room.code]);
        if (toNum(n) >= MP.maxPlayers) throw new HttpError(409, 'That room is full');
      }
      await sql.query(
        `insert into room_players (code, player_id, name) values ($1, $2, $3)
         on conflict (code, player_id) do update set name = excluded.name`,
        [room.code, me, name],
      );
      return json(await roomState(sql, room, me));
    }

    case 'start': {
      const room = await loadRoom(sql, body.code);
      if (room.hostId !== me) throw new HttpError(403, 'Only the host can launch');
      if (room.startAt === null) {
        const startAt = new Date(Date.now() + MP.countdownMs).toISOString();
        await sql.query(`update rooms set start_at = $2 where code = $1 and start_at is null`, [room.code, startAt]);
      }
      return json(await roomState(sql, await loadRoom(sql, room.code), me));
    }

    case 'answer': {
      const room = await loadRoom(sql, body.code);
      const round = Number(body.round);
      const guess = typeof body.guess === 'string' ? body.guess.trim().slice(0, 80) : '';
      if (!guess) throw new HttpError(400, 'Empty answer');

      const [member] = await sql.query(`select 1 from room_players where code = $1 and player_id = $2`, [room.code, me]);
      if (!member) throw new HttpError(403, 'You are not in this room');

      // Accept answers for the open round, plus a short grace window after it closes.
      const now = Date.now();
      const phase = phaseAt(room.startAt, now);
      const late = phaseAt(room.startAt, now - MP.graceMs);
      const open = (p: typeof phase) => p.kind === 'ask' && p.round === round;
      if (!open(phase) && !open(late)) throw new HttpError(409, 'That round is closed');

      const prompt = getPrompt(room.promptIds[round] ?? '');
      if (!prompt) throw new HttpError(400, 'Unknown round');
      const match = matchAnswer(prompt, guess);
      if (!match) return json({ accepted: false });

      const points = TIERS[match.tier].points;
      await sql.query(
        `insert into room_answers (code, player_id, round, guess, matched, tier, points)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (code, player_id, round) do nothing`,
        [room.code, me, round, guess, match.canonical, match.tier, points],
      );
      const [saved] = await sql.query(
        `select matched, tier, points from room_answers where code = $1 and player_id = $2 and round = $3`,
        [room.code, me, round],
      );
      return json({ accepted: true, matched: saved.matched, tier: saved.tier, points: toNum(saved.points) });
    }

    default:
      throw new HttpError(400, 'Unknown action');
  }
});
