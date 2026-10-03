# Spallion

A space-themed take on Krillion: 7 prompts, and the rarer your correct answer, the further your rocket flies.

- **Daily mission:** the same 7 prompts for everyone, resetting at midnight US Eastern. Scores go to the leaderboard.
- **Unlimited flight:** random prompts for practice.
- **Multiplayer:** rooms of up to 30 pilots on a shared clock, with live reveals and standings.

Stack: Vite + React + TypeScript, Three.js + GSAP for the scene, Vercel Functions (`api/`) and Neon Postgres.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` serves the game and the `/api` functions together. Without a `DATABASE_URL` it uses
PGlite (Postgres compiled to WASM), stored in `./.pglite`. Delete that folder to reset local data.

To develop against Neon instead, put the connection string in `.env.local`:

```bash
DATABASE_URL=postgresql://...      # or: vercel env pull .env.local
```

Dev-only shortcut: `http://localhost:5173/?fly=300` launches the rocket straight to 300 pts.

## Deploy (Vercel + Neon)

1. Push this folder to a GitHub repo and import it in Vercel. Vercel detects Vite automatically,
   and `vercel.json` sets the build.
2. In the Vercel project, open **Storage → Create Database → Neon** and connect it to the project.
   This sets `DATABASE_URL` for every environment. If you created the Neon database yourself, add
   `DATABASE_URL` under **Settings → Environment Variables**, using Neon's pooled connection string.
   The database is in **Washington, D.C.** (AWS us-east-1) with Neon Auth off. `vercel.json` pins
   the functions to Vercel's matching region (`iad1`) so they run next to the database.
3. Deploy. The tables are created automatically on the first API request (`api/_lib/db.ts`).

## How it fits together

| Path | What it does |
| --- | --- |
| `data/prompts.json` | 100 prompts with tiered answers (`|` separates aliases) |
| `src/game/` | Rules shared by the client and the API: matching, daily schedule, multiplayer timing |
| `api/scores.ts` | `POST` a daily run. The server re-scores the guesses itself |
| `api/leaderboard.ts` | `GET ?scope=daily` / `?scope=all` |
| `api/rooms.ts` | Multiplayer: create / join / start / answer, plus `GET` room state |
| `src/scene/` | Three.js launch site, rocket and flight |

Players are anonymous: a random id kept in localStorage, plus a callsign. Files in `src/game/` that
the API imports use explicit `.js` import extensions, which Node's ESM loader on Vercel needs.

## Known limits

- The answer lists ship to the browser, so a determined player could look answers up in devtools.
  Scores are re-checked on the server, but daily timers are only enforced in the client.
- Multiplayer uses polling (about one request every 2 s per player), not websockets. That suits
  Vercel's serverless functions, but a very busy game will use more function invocations.
- No rate limiting or profanity filter on callsigns yet.
