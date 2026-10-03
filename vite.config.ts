import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';

/**
 * Serves the Vercel functions in /api from the Vite dev server, so `npm run dev`
 * runs the whole game. Without a DATABASE_URL it uses PGlite (Postgres in WASM),
 * persisted to ./.pglite.
 */
function devApi(): Plugin {
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  async function ensureLocalDb() {
    if (process.env.DATABASE_URL || globalThis.__spallionDb) return;
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite('./.pglite');
    globalThis.__spallionDb = { query: async (text, params) => (await pg.query(text, params)).rows as Record<string, unknown>[] };
    console.log('  ➜  API: using local PGlite database (.pglite). Set DATABASE_URL to use Neon.');
  }

  return {
    name: 'spallion-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          await ensureLocalDb();
          const url = new URL(req.url, 'http://localhost');
          const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
          if (!/^[a-z-]+$/.test(name)) {
            res.statusCode = 404;
            return res.end();
          }
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const handler = mod[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined;
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const request = new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: hasBody ? new Uint8Array(await readBody(req)) : undefined,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  return {
    plugins: [react(), devApi()],
  };
});
