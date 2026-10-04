import type { RoomState } from '../game/multiplayer';
import type { TierId } from '../game/types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, opts: { body?: unknown; playerId?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.playerId) headers['x-player-id'] = opts.playerId;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError("Can't reach mission control. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Server error (${res.status})`, res.status);
  return data as T;
}

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  you?: boolean;
  days?: number;
  best?: number;
}

export interface Board {
  scope: 'daily' | 'all';
  day?: string;
  total: number;
  entries: BoardEntry[];
  you: BoardEntry | null;
}

export interface DailyPostResult {
  score: number;
  rank: number;
  total: number;
  alreadySubmitted: boolean;
}

export type AnswerResult = { accepted: false } | { accepted: true; matched: string; tier: TierId; points: number };

export const api = {
  postDaily: (body: { playerId: string; name: string; day: string; guesses: (string | null)[] }) =>
    request<DailyPostResult>('/api/scores', { body }),

  leaderboard: (scope: 'daily' | 'all', playerId: string) =>
    request<Board>(`/api/leaderboard?scope=${scope}`, { playerId }),

  room: (code: string, playerId: string) => request<RoomState>(`/api/rooms?code=${code}`, { playerId }),

  createRoom: (playerId: string, name: string) =>
    request<RoomState>('/api/rooms', { body: { action: 'create', playerId, name } }),

  joinRoom: (code: string, playerId: string, name: string) =>
    request<RoomState>('/api/rooms', { body: { action: 'join', code, playerId, name } }),

  startRoom: (code: string, playerId: string) =>
    request<RoomState>('/api/rooms', { body: { action: 'start', code, playerId } }),

  answer: (code: string, playerId: string, round: number, guess: string) =>
    request<AnswerResult>('/api/rooms', { body: { action: 'answer', code, playerId, round, guess } }),

  leaveRoom: (code: string, playerId: string) =>
    request<{ left: true }>('/api/rooms', { body: { action: 'leave', code, playerId } }),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
