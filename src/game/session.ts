import { LEGACY_PROMPTS, PROMPTS } from './data.js';
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

// Each daily deck is one fixed shuffle; each day takes the next 7, so prompts don't repeat
// until the whole deck has been used. A deck never changes once it's live: adding prompts
// would reshuffle it and swap the prompts of a day that's already been played (the server
// re-scores submissions against them). Prompts added later still appear in unlimited and
// multiplayer games right away.
const DAILY_EPOCH = Date.UTC(2026, 0, 1);

// Days before the switch keep dealing from the first 100 prompts of prompts.json.
const LEGACY_DECK = shuffled(
  [...LEGACY_PROMPTS].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100),
  mulberry32(hashString('spallion:daily:v1')),
);

// From this day on, the daily deals from prompts2.json, capped at the 48 prompts it shipped with.
const SET2_START = '2026-10-12';
const SET2_DECK_SIZE = 48;
const SET2_DECK = shuffled(
  [...PROMPTS].sort((a, b) => a.id.localeCompare(b.id)).slice(0, SET2_DECK_SIZE),
  mulberry32(hashString('spallion:daily:v2')),
);

const dayNumber = (day: string, epoch: number) => Math.round((Date.parse(`${day}T00:00:00Z`) - epoch) / 86_400_000);

export function dailyPrompts(day = todayKey()): Prompt[] {
  const set2 = day >= SET2_START;
  const deck = set2 ? SET2_DECK : LEGACY_DECK;
  const n = dayNumber(day, set2 ? Date.parse(`${SET2_START}T00:00:00Z`) : DAILY_EPOCH);
  const len = deck.length;
  const start = (((n * ROUNDS_PER_GAME) % len) + len) % len;
  return Array.from({ length: ROUNDS_PER_GAME }, (_, i) => deck[(start + i) % len]);
}

/**
 * A multiplayer room deals from its own shuffled deck: `pos` is how far into the deck the
 * room has played, so a crew sees every prompt once before any repeats. When the deck runs
 * out it's reshuffled for the next cycle; a mission that spans two cycles skips prompts it
 * already has.
 */
export function dealFromDeck(seed: number, pos: number): { prompts: Prompt[]; next: number } {
  const sorted = [...PROMPTS].sort((a, b) => a.id.localeCompare(b.id));
  const decks = new Map<number, Prompt[]>();
  const at = (i: number) => {
    const cycle = Math.floor(i / sorted.length);
    let deck = decks.get(cycle);
    if (!deck) decks.set(cycle, (deck = shuffled(sorted, mulberry32((seed + cycle * 0x9e3779b9) >>> 0))));
    return deck[i % sorted.length];
  };
  const prompts: Prompt[] = [];
  let i = pos;
  while (prompts.length < Math.min(ROUNDS_PER_GAME, sorted.length)) {
    const p = at(i++);
    if (!prompts.includes(p)) prompts.push(p);
  }
  return { prompts, next: i };
}

/** A random deck seed for a new room. */
export const newDeckSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Rooms made before decks existed have no stored seed, so derive one from the code. */
export const deckSeedFor = (code: string) => hashString(`spallion:room:${code}`) & 0x7fffffff;

/** Daily: today's shared set. Unlimited: random, avoiding the last game's prompts. */
export function pickPrompts(mode: Mode, avoid: string[] = []): Prompt[] {
  if (mode === 'daily') return dailyPrompts();
  const fresh = PROMPTS.filter((p) => !avoid.includes(p.id));
  const pool = fresh.length >= ROUNDS_PER_GAME ? fresh : PROMPTS;
  return shuffled(pool, Math.random).slice(0, ROUNDS_PER_GAME);
}
