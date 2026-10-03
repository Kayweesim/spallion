export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 10_000) throw new HttpError(413, 'Request too large');
  try {
    const body = JSON.parse(text || '{}');
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Wrap a handler so thrown HttpErrors become JSON responses and anything else a 500. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function playerId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'Missing or invalid player id');
  return v.toLowerCase();
}

/** Callsigns: 2–16 visible characters, single-spaced. */
export function callsign(v: unknown): string {
  const name = typeof v === 'string' ? v.normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 16) throw new HttpError(400, 'Callsign must be 2–16 characters');
  return name;
}
