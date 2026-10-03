// Shared with the serverless API, so relative imports carry explicit .js extensions (Node ESM).
import raw from '../../data/prompts.json' with { type: 'json' };
import type { Prompt, Tier, TierId } from './types.js';

export const TIERS = raw.tiers as Record<TierId, Tier>;
export const PROMPTS = raw.prompts as unknown as Prompt[];
export const ALIAS_SEPARATOR = raw.aliasSeparator;

const byId = new Map(PROMPTS.map((p) => [p.id, p]));

export function getPrompt(id: string): Prompt | undefined {
  return byId.get(id);
}

export const TIER_COLORS: Record<TierId, string> = {
  dust: '#9aa3c7',
  satellite: '#ffe14d',
  asteroid: '#00f0ff',
  comet: '#3dff9a',
  nebula: '#ff2bd6',
  lightyear: '#ffffff',
};

export const TIER_EMOJI: Record<TierId, string> = {
  dust: '⚪',
  satellite: '🛰️',
  asteroid: '🪨',
  comet: '☄️',
  nebula: '🌌',
  lightyear: '🌟',
};

export const MISS_EMOJI = '⬛';

/** "lion's mane jellyfish|..." → "Lion's Mane Jellyfish" */
export function displayName(entry: string): string {
  const first = entry.split(ALIAS_SEPARATOR)[0];
  return first.replace(/(^|[\s(-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
}

/** A few of the rarest accepted answers for a prompt, for reveal/results screens. */
export function rarestExamples(prompt: Prompt, count = 3): string[] {
  const pool = [...prompt.answers.lightyear, ...prompt.answers.nebula, ...prompt.answers.comet];
  return pool.slice(0, count).map(displayName);
}
