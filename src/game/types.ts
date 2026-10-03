export type TierId = 'dust' | 'satellite' | 'asteroid' | 'comet' | 'nebula' | 'lightyear';

export const TIER_ORDER: TierId[] = ['dust', 'satellite', 'asteroid', 'comet', 'nebula', 'lightyear'];

export interface Tier {
  name: string;
  points: number;
  blurb: string;
}

export interface Prompt {
  id: string;
  category: string;
  prompt: string;
  qualifier: string | null;
  answers: Record<TierId, string[]>;
}

export type Mode = 'daily' | 'unlimited';

export interface RoundResult {
  promptId: string;
  answer: string | null; // what the player typed (null = timed out)
  matched: string | null; // canonical answer it matched
  tier: TierId | null;
  points: number;
}

export const ROUNDS_PER_GAME = 7;
export const MAX_SCORE = ROUNDS_PER_GAME * 100;
