import { shiftDay, todayKey, yesterdayKey } from './session';
import type { RoundResult } from './types';

const KEY = 'spallion.v1';

interface Store {
  daily: Record<string, RoundResult[]>;
  streak: { count: number; last: string | null };
  best: number;
  lastUnlimited: string[];
  profile: { id: string; name: string } | null;
}

const empty = (): Store => ({ daily: {}, streak: { count: 0, last: null }, best: 0, lastUnlimited: [], profile: null });

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked (private mode etc.) — progress just won't persist.
  }
}

export function getTodaysDaily(): RoundResult[] | null {
  return load().daily[todayKey()] ?? null;
}

export function getStats() {
  const s = load();
  const live = s.streak.last === todayKey() || s.streak.last === yesterdayKey();
  return { streak: live ? s.streak.count : 0, best: s.best };
}

export function getLastUnlimited(): string[] {
  return load().lastUnlimited;
}

export function recordGame(mode: 'daily' | 'unlimited', rounds: RoundResult[], day = todayKey()) {
  const s = load();
  const total = rounds.reduce((n, r) => n + r.points, 0);
  s.best = Math.max(s.best, total);
  if (mode === 'daily') {
    s.daily[day] = rounds;
    if (s.streak.last !== day) {
      s.streak = { count: s.streak.last === shiftDay(day, -1) ? s.streak.count + 1 : 1, last: day };
    }
  } else {
    s.lastUnlimited = rounds.map((r) => r.promptId);
  }
  save(s);
}

/** Anonymous player identity: a random id (kept private, acts as a token) plus a public callsign. */
export function getProfile(): { id: string; name: string } {
  const s = load();
  if (!s.profile) {
    s.profile = { id: crypto.randomUUID(), name: '' };
    save(s);
  }
  return s.profile;
}

export function setCallsign(name: string) {
  const s = load();
  s.profile = { id: s.profile?.id ?? crypto.randomUUID(), name };
  save(s);
}
