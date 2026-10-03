import { PROMPTS } from './data.js';
import { ROUNDS_PER_GAME, type Mode, type Prompt } from './types.js';

/** The daily mission rolls over at midnight US Eastern for everyone, client and server alike. */
export const DAILY_TIMEZONE = 'America/New_York';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD in the daily timezone. */
export function todayKey(now = new Date()): string {
  return dayFormat.format(now);
}

export function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function yesterdayKey(): string {
  return shiftDay(todayKey(), -1);
}

export const isDayKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One fixed shuffle of every prompt; each day takes the next 7, so prompts don't
// repeat until the whole deck has been used.
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
const dailyDeck = shuffled(
  [...PROMPTS].sort((a, b) => a.id.localeCompare(b.id)),
  mulberry32(hashString('spallion:daily:v1')),
);

export function dailyPrompts(day = todayKey()): Prompt[] {
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - DAILY_EPOCH) / 86_400_000);
  const len = dailyDeck.length;
  const start = (((n * ROUNDS_PER_GAME) % len) + len) % len;
  return Array.from({ length: ROUNDS_PER_GAME }, (_, i) => dailyDeck[(start + i) % len]);
}

/** Daily: today's shared set. Unlimited: random, avoiding the last game's prompts. */
export function pickPrompts(mode: Mode, avoid: string[] = []): Prompt[] {
  if (mode === 'daily') return dailyPrompts();
  const fresh = PROMPTS.filter((p) => !avoid.includes(p.id));
  const pool = fresh.length >= ROUNDS_PER_GAME ? fresh : PROMPTS;
  return shuffled(pool, Math.random).slice(0, ROUNDS_PER_GAME);
}
