import { TIER_ORDER, type TierId } from '../game/types';

/**
 * Retro synth sound effects, generated live with the Web Audio API
 * (no audio files). The context is created lazily on the first user gesture.
 */

const MUTE_KEY = 'spallion.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  attack?: number;
}

function tone(freq: number, at: number, dur: number, { type = 'square', gain = 0.15, slideTo, attack = 0.005 }: ToneOpts = {}) {
  const c = audio();
  if (!c || !master) return;
  const start = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

interface NoiseOpts {
  gain?: number;
  from?: number;
  to?: number;
  filter?: BiquadFilterType;
  attack?: number;
}

function noise(at: number, dur: number, { gain = 0.2, from = 800, to = 800, filter = 'lowpass', attack = 0.01 }: NoiseOpts = {}) {
  const c = audio();
  if (!c || !master || !noiseBuffer) return;
  const start = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(from, start);
  f.frequency.exponentialRampToValueAtTime(to, start + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master);
  src.start(start);
  src.stop(start + dur + 0.05);
}

// C major pentatonic, two octaves up from C5
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];

export const sfx = {
  isMuted: () => muted,

  setMuted(value: boolean) {
    muted = value;
    try {
      localStorage.setItem(MUTE_KEY, value ? '1' : '0');
    } catch {
      // ignore
    }
    if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.5, ctx.currentTime, 0.02);
  },

  /** Unlock audio on the first gesture so later effects aren't blocked. */
  unlock() {
    audio();
  },

  click() {
    tone(1200, 0, 0.04, { gain: 0.06 });
    tone(1800, 0.025, 0.05, { gain: 0.05 });
  },

  /** Countdown tick for the last seconds; higher pitch as it gets closer. */
  tick(secondsLeft: number) {
    tone(secondsLeft <= 2 ? 1400 : 1000, 0, 0.07, { gain: 0.07 });
  },

  /** Answer not recognised. */
  reject() {
    tone(196, 0, 0.12, { type: 'sawtooth', gain: 0.12 });
    tone(147, 0.1, 0.2, { type: 'sawtooth', gain: 0.12 });
  },

  /** Ignition + engine roar, scaled by how big the burn is (0..1). */
  launch(intensity: number) {
    const dur = 1.2 + intensity * 1.6;
    noise(0, dur, { gain: 0.22 + intensity * 0.15, from: 180, to: 900 + intensity * 1800, attack: 0.15 });
    tone(55, 0, dur, { type: 'sawtooth', gain: 0.08, slideTo: 110 + intensity * 120, attack: 0.2 });
  },

  /** Rising arpeggio: rarer tiers climb higher and longer. */
  tier(tier: TierId) {
    const rank = TIER_ORDER.indexOf(tier);
    const notes = 2 + rank;
    for (let i = 0; i < notes; i++) {
      // Higher tiers also start further up the scale.
      tone(SCALE[Math.min(rank + i, SCALE.length - 1)], 0.15 + i * 0.07, 0.18, { type: rank >= 3 ? 'square' : 'triangle', gain: 0.1 });
    }
    if (tier === 'lightyear' || tier === 'nebula') {
      // Sparkle shimmer
      for (let i = 0; i < 8; i++) tone(2093 + Math.random() * 1500, 0.6 + i * 0.05, 0.25, { type: 'sine', gain: 0.05 });
    }
  },

  /** Time ran out: engines power down. */
  miss() {
    tone(440, 0, 0.7, { type: 'sawtooth', gain: 0.12, slideTo: 60 });
    noise(0, 0.4, { gain: 0.12, from: 1200, to: 200 });
  },

  /** End-of-mission fanfare, longer for better runs. */
  results(score: number) {
    const steps = 3 + Math.round((score / 700) * 5);
    for (let i = 0; i < steps; i++) tone(SCALE[i], i * 0.1, 0.22, { type: 'square', gain: 0.09 });
    tone(SCALE[steps - 1] / 2, steps * 0.1, 0.6, { type: 'triangle', gain: 0.12 });
  },
};
