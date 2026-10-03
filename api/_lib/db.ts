import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;

export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

declare global {
  // Set by the Vite dev server to an in-process PGlite database (see vite.config.ts).
  var __spallionDb: Db | undefined;
}

const SCHEMA = [
  `create table if not exists players (
     id uuid primary key,
     name text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists daily_scores (
     player_id uuid not null references players(id),
     day date not null,
     score integer not null,
     rounds jsonb not null,
     created_at timestamptz not null default now(),
     primary key (player_id, day)
   )`,
  `create index if not exists daily_scores_by_day on daily_scores (day, score desc)`,
  `create table if not exists rooms (
     code text primary key,
     host_id uuid not null,
     prompt_ids text not null,
     start_at timestamptz,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists room_players (
     code text not null references rooms(code) on delete cascade,
     player_id uuid not null,
     name text not null,
     joined_at timestamptz not null default now(),
     primary key (code, player_id)
   )`,
  `create table if not exists room_answers (
     code text not null references rooms(code) on delete cascade,
     player_id uuid not null,
     round integer not null,
     guess text not null,
     matched text not null,
     tier text not null,
     points integer not null,
     answered_at timestamptz not null default now(),
     primary key (code, player_id, round)
   )`,
];

let pool: Db | null = null;
let schema: Promise<void> | null = null;

function connect(): Db {
  if (globalThis.__spallionDb) return globalThis.__spallionDb;
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const sql = neon(url);
    pool = { query: (text, params = []) => sql.query(text, params) as Promise<Row[]> };
  }
  return pool;
}

/** Database handle with the schema guaranteed to exist (created once per cold start). */
export async function db(): Promise<Db> {
  const conn = connect();
  schema ??= (async () => {
    for (const stmt of SCHEMA) await conn.query(stmt);
  })().catch((err) => {
    schema = null; // retry on the next request
    throw err;
  });
  await schema;
  return conn;
}

/** Postgres drivers return timestamps/bigints in different shapes; normalise them. */
export const toMs = (v: unknown): number | null => (v == null ? null : new Date(v as string | Date).getTime());
export const toNum = (v: unknown): number => Number(v ?? 0);
