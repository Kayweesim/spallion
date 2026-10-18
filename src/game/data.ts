// Shared with the serverless API, so relative imports carry explicit .js extensions (Node ESM).
import legacy from '../../data/prompts.json' with { type: 'json' };
import set2 from '../../data/prompts2.json' with { type: 'json' };
import set3 from '../../data/prompts3.json' with { type: 'json' };
import raw from '../../data/prompts4.json' with { type: 'json' };
import type { Prompt, Tier, TierId } from './types.js';

export const TIERS = raw.tiers as Record<TierId, Tier>;
/** The prompts games deal from now (prompts4.json). */
export const PROMPTS = raw.prompts as unknown as Prompt[];
/** Which file PROMPTS came from. Rooms restart their deck when this changes. */
export const PROMPT_SET = 'prompts4';
/**
 * Earlier sets (prompts.json to prompts3.json), no longer dealt. Still looked up by id so past
 * daily missions, saved results and rooms created before a switch keep their prompts.
 */
export const LEGACY_PROMPTS = legacy.prompts as unknown as Prompt[];
export const SET2_PROMPTS = set2.prompts as unknown as Prompt[];
export const SET3_PROMPTS = set3.prompts as unknown as Prompt[];
export const ALIAS_SEPARATOR = raw.aliasSeparator;

const byId = new Map([...LEGACY_PROMPTS, ...SET2_PROMPTS, ...SET3_PROMPTS, ...PROMPTS].map((p) => [p.id, p]));

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
