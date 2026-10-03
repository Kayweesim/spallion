import { ALIAS_SEPARATOR } from './data.js';
import { TIER_ORDER, type Prompt, type TierId } from './types.js';

export interface Match {
  tier: TierId;
  canonical: string; // full entry string, e.g. "t rex|t-rex|tyrannosaurus"
}

/**
 * Collapse an answer to a comparison key: lowercase, no accents, no punctuation,
 * no leading article, no spaces. "+" and "#" survive so C, C++ and C# stay distinct.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, '');
}

/** Crude plural folding, applied identically to answers and guesses. */
function singular(k: string): string {
  if (k.length > 4 && k.endsWith('ies')) return k.slice(0, -3) + 'y';
  if (k.length > 4 && /(s|x|z|ch|sh)es$/.test(k)) return k.slice(0, -2);
  if (k.length > 3 && k.endsWith('s') && !/(ss|us|is)$/.test(k)) return k.slice(0, -1);
  return k;
}

const key = (s: string) => singular(normalize(s));

const indexCache = new Map<string, Map<string, Match>>();

function indexFor(prompt: Prompt): Map<string, Match> {
  let idx = indexCache.get(prompt.id);
  if (idx) return idx;
  idx = new Map();
  for (const tier of TIER_ORDER) {
    for (const entry of prompt.answers[tier]) {
      for (const alias of entry.split(ALIAS_SEPARATOR)) {
        const k = key(alias);
        if (k && !idx.has(k)) idx.set(k, { tier, canonical: entry });
      }
    }
  }
  indexCache.set(prompt.id, idx);
  return idx;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function matchAnswer(prompt: Prompt, guess: string): Match | null {
  const q = key(guess);
  if (!q) return null;
  const idx = indexFor(prompt);
  const exact = idx.get(q);
  if (exact) return exact;

  // Typo tolerance only for longer words, so short answers ("won", "sol", "c") stay exact.
  if (q.length < 5) return null;
  const maxDist = q.length >= 9 ? 2 : 1;
  let best: Match | null = null;
  let bestDist = Infinity;
  let ambiguous = false;
  for (const [k, m] of idx) {
    if (k.length < 4) continue;
    const d = levenshtein(q, k, maxDist);
    if (d < bestDist) {
      best = m;
      bestDist = d;
      ambiguous = false;
    } else if (d === bestDist && best && m.canonical !== best.canonical) {
      ambiguous = true;
    }
  }
  return best && bestDist <= maxDist && !ambiguous ? best : null;
}
