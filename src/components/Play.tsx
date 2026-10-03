import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { TIERS, TIER_COLORS, displayName, rarestExamples } from '../game/data';
import { landmarkAt, nextLandmark } from '../game/landmarks';
import { matchAnswer } from '../game/match';
import { sfx } from '../audio/sfx';
import { PromptText, TimerBar } from './parts';
import type { Mode, Prompt, RoundResult } from '../game/types';
import type { SpaceScene } from '../scene/SpaceScene';

const ROUND_SECONDS: Record<Mode, number> = { daily: 20, unlimited: 25 };

interface Props {
  mode: Mode;
  prompts: Prompt[];
  scene: SpaceScene | null;
  onDone: (rounds: RoundResult[]) => void;
  onQuit: () => void;
}

export function Play({ mode, prompts, scene, onDone, onQuit }: Props) {
  const seconds = ROUND_SECONDS[mode];
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'reveal'>('ask');
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  const [timeLeft, setTimeLeft] = useState(seconds);

  const root = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const resolved = useRef(false);
  const lastTick = useRef(0);

  const prompt = prompts[idx];
  const total = rounds.reduce((n, r) => n + r.points, 0);
  const current = phase === 'reveal' ? rounds[rounds.length - 1] : null;
  const here = landmarkAt(total);
  const next = nextLandmark(total);

  const resolve = (answer: string | null, match: ReturnType<typeof matchAnswer>) => {
    if (resolved.current) return;
    resolved.current = true;
    const round: RoundResult = {
      promptId: prompt.id,
      answer,
      matched: match?.canonical ?? null,
      tier: match?.tier ?? null,
      points: match ? TIERS[match.tier].points : 0,
    };
    setRounds((r) => [...r, round]);
    setPhase('reveal');
    if (match) {
      scene?.flyTo(total + round.points);
      sfx.launch(round.points / 100);
      sfx.tier(match.tier);
    } else {
      scene?.miss();
      sfx.miss();
    }
  };

  // Round timer.
  useEffect(() => {
    if (phase !== 'ask') return;
    resolved.current = false;
    lastTick.current = 0;
    const deadline = performance.now() + seconds * 1000;
    setTimeLeft(seconds);
    inputEl.current?.focus();
    const id = window.setInterval(() => {
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      setTimeLeft(left);
      const whole = Math.ceil(left);
      if (whole <= 5 && whole > 0 && whole !== lastTick.current) {
        lastTick.current = whole;
        sfx.tick(whole);
      }
      if (left <= 0) {
        window.clearInterval(id);
        resolve(null, null);
      }
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, phase]);

  useEffect(() => {
    if (phase === 'reveal') nextBtn.current?.focus();
  }, [phase]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (phase !== 'ask') return;
    const guess = input.trim();
    if (!guess) return;
    const match = matchAnswer(prompt, guess);
    if (!match) {
      setError(`"${guess}" isn't in the star charts. Try another.`);
      setErrorTick((t) => t + 1);
      sfx.reject();
      inputEl.current?.select();
      return;
    }
    resolve(guess, match);
  };

  const advance = () => {
    if (idx === prompts.length - 1) {
      onDone(rounds);
      return;
    }
    setIdx((i) => i + 1);
    setPhase('ask');
    setInput('');
    setError(null);
  };

  // New question: card slides in (the prompt text decodes itself in PromptText).
  useGSAP(
    () => {
      gsap.from('.q-card', { y: 24, opacity: 0, duration: 0.45, ease: 'power3.out' });
    },
    { scope: root, dependencies: [idx] },
  );

  // Answer reveal: tier badge slams in, points count up.
  useGSAP(
    () => {
      if (phase !== 'reveal' || !current) return;
      const tl = gsap.timeline();
      tl.from('.reveal-badge', { scale: 2.4, opacity: 0, rotate: -6, duration: 0.55, ease: 'back.out(2.2)' })
        .from('.reveal-detail', { y: 10, opacity: 0, stagger: 0.08, duration: 0.35 }, '-=0.2');
      const pts = root.current?.querySelector('.reveal-points-num');
      if (pts) tl.from(pts, { innerText: 0, snap: { innerText: 1 }, duration: 0.8, ease: 'power2.out' }, 0.2);
      if (current.tier === 'lightyear' || current.tier === 'nebula') {
        gsap.fromTo('.flash', { opacity: current.tier === 'lightyear' ? 0.5 : 0.25 }, { opacity: 0, duration: 1.2, ease: 'power2.out' });
      }
    },
    { scope: root, dependencies: [phase, idx] },
  );

  useGSAP(
    () => {
      if (!errorTick) return;
      gsap.fromTo('.answer-row', { x: -14 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
    },
    { scope: root, dependencies: [errorTick] },
  );

  const tierColor = current?.tier ? TIER_COLORS[current.tier] : 'var(--danger)';

  return (
    <div className="screen play" ref={root}>
      <div className="flash" aria-hidden="true" />

      <header className="hud">
        <button className="btn btn-ghost btn-small" onClick={onQuit}>Abort</button>
        <ol className="pips" aria-label={`Question ${idx + 1} of ${prompts.length}`}>
          {prompts.map((p, i) => {
            const r = rounds[i];
            const color = r ? (r.tier ? TIER_COLORS[r.tier] : 'var(--danger)') : undefined;
            return (
              <li
                key={p.id}
                className={`pip ${i === idx ? 'pip-current' : ''} ${r ? 'pip-done' : ''}`}
                style={color ? ({ '--pip': color } as CSSProperties) : undefined}
              />
            );
          })}
        </ol>
        <div className="hud-score">
          <span className="hud-label">{here.name}</span>
          <span className="hud-value">{total} <small>pts</small></span>
          {next && <span className="hud-next">next: {next.name} @ {next.points}</span>}
        </div>
      </header>

      <section className="q-card panel" aria-live="polite">
        <div className="q-meta">
          <span className="chip">{prompt.category}</span>
          <span className="q-count">Prompt {idx + 1} / {prompts.length}</span>
        </div>
        <PromptText text={prompt.prompt} />
        {prompt.qualifier && <p className="q-qualifier">⚠ {prompt.qualifier}</p>}

        {phase === 'ask' ? (
          <>
            <TimerBar left={timeLeft} total={seconds} />
            <form className="answer-row" onSubmit={submit}>
              <input
                ref={inputEl}
                className="answer-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Type your answer…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Your answer"
              />
              <button className="btn btn-primary" type="submit">Launch</button>
            </form>
            <p className="q-error" role="alert">{error ?? ' '}</p>
          </>
        ) : (
          current && (
            <div className="reveal" style={{ '--tier': tierColor } as CSSProperties}>
              <div className="reveal-badge">
                <span className="reveal-tier">{current.tier ? TIERS[current.tier].name : 'Signal lost'}</span>
                <span className="reveal-points">+<span className="reveal-points-num">{current.points}</span></span>
              </div>
              {current.matched ? (
                <p className="reveal-detail">
                  Logged: <b>{displayName(current.matched)}</b>
                  {current.tier && <span className="muted"> · {TIERS[current.tier].blurb}</span>}
                </p>
              ) : (
                <p className="reveal-detail">Out of time. Your engines sputtered.</p>
              )}
              <p className="reveal-detail muted">
                Deep-space answers: {rarestExamples(prompt).join(', ')}
              </p>
              <button className="btn btn-primary reveal-detail" ref={nextBtn} onClick={advance}>
                {idx === prompts.length - 1 ? 'Mission report ▸' : 'Next prompt ▸'}
              </button>
            </div>
          )
        )}
      </section>
    </div>
  );
}
