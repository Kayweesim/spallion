import { ROUNDS_PER_GAME, type TierId } from './types.js';

/**
 * Multiplayer runs on a shared clock: once the host launches, every phase is
 * derived from `startAt`, so clients only need to poll for other players' answers.
 */
export const MP = {
  countdownMs: 5_000,
  askMs: 25_000,
  revealMs: 10_000,
  graceMs: 1_500, // late answers still accepted for network lag
  maxPlayers: 30,
  rounds: ROUNDS_PER_GAME,
};

/** From the first question opening to the end of the last reveal. */
export const GAME_MS = MP.rounds * (MP.askMs + MP.revealMs);

export type MpPhase =
  | { kind: 'lobby' }
  | { kind: 'countdown'; endsAt: number }
  | { kind: 'ask'; round: number; endsAt: number }
  | { kind: 'reveal'; round: number; endsAt: number }
  | { kind: 'finished' };

/** `startAt` = when round 0's question opens (end of the countdown). */
export function phaseAt(startAt: number | null, now: number): MpPhase {
  if (startAt === null) return { kind: 'lobby' };
  if (now < startAt) return { kind: 'countdown', endsAt: startAt };
  if (now >= startAt + GAME_MS) return { kind: 'finished' };
  const slot = MP.askMs + MP.revealMs;
  const round = Math.floor((now - startAt) / slot);
  const askEnds = startAt + round * slot + MP.askMs;
  return now < askEnds
    ? { kind: 'ask', round, endsAt: askEnds }
    : { kind: 'reveal', round, endsAt: askEnds + MP.revealMs };
}

/** Rounds whose answers are public (the ask window has closed). */
export function revealedRounds(phase: MpPhase): number {
  switch (phase.kind) {
    case 'lobby':
    case 'countdown':
      return 0;
    case 'ask':
      return phase.round;
    case 'reveal':
      return phase.round + 1;
    case 'finished':
      return MP.rounds;
  }
}

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (s: unknown): s is string => typeof s === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(s);

// ---------------------------------------------------------------- API shapes

export interface RoomPlayer {
  slot: number;
  name: string;
  you: boolean;
  host: boolean;
  /** False for players who joined after the current (or last) mission launched. */
  inGame: boolean;
  score: number;
  answeredCurrent: boolean;
}

export interface RoomAnswer {
  slot: number;
  name: string;
  matched: string;
  tier: TierId;
  points: number;
}

export interface RoomState {
  code: string;
  promptIds: string[];
  startAt: number | null;
  serverNow: number;
  youAreIn: boolean;
  players: RoomPlayer[];
  /** answers[round] for every revealed round */
  answers: RoomAnswer[][];
  /** Your locked-in answer for the round currently open, if any. */
  yourCurrent: { round: number; matched: string; tier: TierId; points: number } | null;
}
