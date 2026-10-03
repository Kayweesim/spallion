import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { TIERS, TIER_COLORS, displayName, getPrompt, rarestExamples } from '../game/data';
import { landmarkAt } from '../game/landmarks';
import { MP, phaseAt, type MpPhase, type RoomState } from '../game/multiplayer';
import { getProfile } from '../game/storage';
import { api, errorMessage } from '../net/api';
import { sfx } from '../audio/sfx';
import type { SpaceScene } from '../scene/SpaceScene';
import { PromptText, TimerBar } from './parts';

interface Props {
  code: string;
  scene: SpaceScene | null;
  onLeave: () => void;
}

// How often to poll the room in each phase (ms). Phase changes also trigger an immediate fetch.
const POLL: Record<MpPhase['kind'], number> = { lobby: 2000, countdown: 1000, ask: 2500, reveal: 2000, finished: 0 };

export function MultiRoom({ code, scene, onLeave }: Props) {
  const me = getProfile();
  const [state, setState] = useState<RoomState | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0); // server clock − local clock

  // Local clock tick drives timers; phases are derived from the shared start time.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  const serverNow = now + offset.current;
  const phase: MpPhase = state ? phaseAt(state.startAt, serverNow) : { kind: 'lobby' };
  const phaseKey = `${phase.kind}:${'round' in phase ? phase.round : ''}`;

  const refresh = async () => {
    const sent = Date.now();
    const s = await api.room(code, me.id);
    offset.current = s.serverNow - (sent + Date.now()) / 2;
    setState(s);
    setNetError(null);
  };

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const delay = POLL[phase.kind];
    const tick = async () => {
      try {
        await refresh();
      } catch (e) {
        if (alive) setNetError(errorMessage(e));
      }
      if (alive && delay) timer = window.setTimeout(tick, delay);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey]);

  const you = state?.players.find((p) => p.you);

  // Fly (or sputter) once per round, when that round's results arrive.
  const flown = useRef(-1);
  useEffect(() => {
    if (!state || !you || phase.kind !== 'reveal' && phase.kind !== 'finished') return;
    const r = state.answers.length - 1;
    if (r < 0 || r <= flown.current) return;
    flown.current = r;
    const mine = state.answers[r].find((a) => a.slot === you.slot);
    if (mine) {
      scene?.flyTo(you.score);
      sfx.launch(mine.points / 100);
      sfx.tier(mine.tier);
    } else {
      scene?.miss();
      sfx.miss();
    }
  }, [state, you, phase.kind, scene]);

  if (!state) {
    return (
      <div className="screen multi">
        <p className="muted center">{netError ?? `Connecting to room ${code}…`}</p>
        {netError && <button className="btn btn-ghost" onClick={onLeave}>Back</button>}
      </div>
    );
  }

  return (
    <div className="screen multi-room">
      <div className="flash" aria-hidden="true" />
      {phase.kind === 'lobby' && <Lobby state={state} onLeave={onLeave} onStarted={setState} />}
      {phase.kind === 'countdown' && <Countdown endsAt={phase.endsAt} serverNow={serverNow} />}
      {phase.kind === 'ask' && (
        <Ask key={phase.round} state={state} round={phase.round} endsAt={phase.endsAt} serverNow={serverNow} onLeave={onLeave} />
      )}
      {phase.kind === 'reveal' && (
        <Reveal state={state} round={phase.round} endsAt={phase.endsAt} serverNow={serverNow} />
      )}
      {phase.kind === 'finished' && <Final state={state} onLeave={onLeave} />}
      {netError && <p className="q-error net-error">{netError} Retrying…</p>}
    </div>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({ state, onLeave, onStarted }: { state: RoomState; onLeave: () => void; onStarted: (s: RoomState) => void }) {
  const me = getProfile();
  const host = state.players.find((p) => p.you)?.host ?? false;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${location.origin}${location.pathname}?room=${state.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy the invite link:', link);
    }
  };

  const launch = async () => {
    try {
      onStarted(await api.startRoom(state.code, me.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <header className="results-head">
        <p className="eyebrow">Room code</p>
        <h1 className="room-code">{state.code}</h1>
        <button className="btn btn-small" onClick={copy}>{copied ? 'Link copied ✓' : 'Copy invite link'}</button>
      </header>

      <section className="panel">
        <h2 className="panel-title">Crew · {state.players.length}/{MP.maxPlayers}</h2>
        <ul className="crew">
          {state.players.map((p) => (
            <li key={p.slot} className={p.you ? 'crew-you' : ''}>
              {p.name}
              {p.host && <span className="chip chip-host">Host</span>}
              {p.you && <span className="muted"> (you)</span>}
            </li>
          ))}
        </ul>
      </section>

      <p className="q-error" role="alert">{error ?? ' '}</p>
      <div className="results-actions">
        {host ? (
          <button className="btn btn-primary" onClick={launch}>Launch mission</button>
        ) : (
          <p className="muted">Waiting for the host to launch…</p>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>Leave</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- countdown

function Countdown({ endsAt, serverNow }: { endsAt: number; serverNow: number }) {
  const n = Math.max(1, Math.ceil((endsAt - serverNow) / 1000));
  const last = useRef(0);
  useEffect(() => {
    if (n !== last.current) {
      last.current = n;
      sfx.tick(n);
    }
  }, [n]);
  return (
    <div className="countdown" aria-live="assertive">
      <p className="eyebrow">Launch in</p>
      <p className="countdown-num" key={n}>{n}</p>
    </div>
  );
}

// ---------------------------------------------------------------- question

interface AskProps {
  state: RoomState;
  round: number;
  endsAt: number;
  serverNow: number;
  onLeave: () => void;
}

function Ask({ state, round, endsAt, serverNow, onLeave }: AskProps) {
  const me = getProfile();
  const root = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const prompt = getPrompt(state.promptIds[round])!;
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<string | null>(state.yourCurrent?.round === round ? state.yourCurrent.matched : null);
  const left = Math.max(0, (endsAt - serverNow) / 1000);
  const lastTick = useRef(0);
  const you = state.players.find((p) => p.you);
  const answered = state.players.filter((p) => p.answeredCurrent).length;

  useEffect(() => {
    inputEl.current?.focus();
  }, []);

  useEffect(() => {
    const whole = Math.ceil(left);
    if (!locked && whole <= 5 && whole > 0 && whole !== lastTick.current) {
      lastTick.current = whole;
      sfx.tick(whole);
    }
  }, [left, locked]);

  useGSAP(() => {
    gsap.from('.q-card', { y: 24, opacity: 0, duration: 0.45, ease: 'power3.out' });
  }, { scope: root });

  useGSAP(
    () => {
      if (errorTick) gsap.fromTo('.answer-row', { x: -14 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
    },
    { scope: root, dependencies: [errorTick] },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const guess = input.trim();
    if (!guess || busy || locked) return;
    setBusy(true);
    try {
      const res = await api.answer(state.code, me.id, round, guess);
      if (res.accepted) {
        setLocked(res.matched);
        sfx.click();
      } else {
        setError(`"${guess}" isn't in the star charts. Try another.`);
        setErrorTick((t) => t + 1);
        sfx.reject();
        inputEl.current?.select();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="ask">
      <header className="hud">
        <button className="btn btn-ghost btn-small" onClick={onLeave}>Leave</button>
        <ol className="pips" aria-label={`Prompt ${round + 1} of ${MP.rounds}`}>
          {state.promptIds.map((id, i) => (
            <li key={id} className={`pip ${i === round ? 'pip-current' : ''} ${i < round ? 'pip-done' : ''}`} style={i < round ? ({ '--pip': 'var(--violet)' } as CSSProperties) : undefined} />
          ))}
        </ol>
        <div className="hud-score">
          <span className="hud-label">{landmarkAt(you?.score ?? 0).name}</span>
          <span className="hud-value">{you?.score ?? 0} <small>pts</small></span>
          <span className="hud-next">{answered}/{state.players.length} locked in</span>
        </div>
      </header>

      <section className="q-card panel" aria-live="polite">
        <div className="q-meta">
          <span className="chip">{prompt.category}</span>
          <span className="q-count">Prompt {round + 1} / {MP.rounds}</span>
        </div>
        <PromptText text={prompt.prompt} />
        {prompt.qualifier && <p className="q-qualifier">⚠ {prompt.qualifier}</p>}
        <TimerBar left={left} total={MP.askMs / 1000} />
        {locked ? (
          <p className="lock-in">
            Locked in: <b>{displayName(locked)}</b>
            <span className="muted"> · rarity revealed when the timer ends</span>
          </p>
        ) : (
          <>
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
              <button className="btn btn-primary" type="submit" disabled={busy}>Launch</button>
            </form>
            <p className="q-error" role="alert">{error ?? ' '}</p>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- reveal

function Reveal({ state, round, endsAt, serverNow }: { state: RoomState; round: number; endsAt: number; serverNow: number }) {
  const root = useRef<HTMLDivElement>(null);
  const prompt = getPrompt(state.promptIds[round])!;
  const answers = state.answers[round];
  const you = state.players.find((p) => p.you);
  const mine = answers?.find((a) => a.slot === you?.slot);
  const answeredSlots = new Set(answers?.map((a) => a.slot));
  const missed = state.players.filter((p) => !answeredSlots.has(p.slot));
  const standings = [...state.players].sort((a, b) => b.score - a.score);
  const color = mine ? TIER_COLORS[mine.tier] : 'var(--danger)';

  useGSAP(
    () => {
      if (!answers) return;
      gsap.from('.reveal-badge', { scale: 2.2, opacity: 0, rotate: -6, duration: 0.5, ease: 'back.out(2.2)' });
      gsap.from('.room-answer', { opacity: 0, x: -14, stagger: 0.05, duration: 0.3, delay: 0.2 });
      if (mine && (mine.tier === 'lightyear' || mine.tier === 'nebula')) {
        gsap.fromTo('.flash', { opacity: mine.tier === 'lightyear' ? 0.5 : 0.25 }, { opacity: 0, duration: 1.2 });
      }
    },
    { scope: root, dependencies: [answers === undefined] },
  );

  return (
    <div ref={root} className="reveal-room">
      <p className="eyebrow">Prompt {round + 1} / {MP.rounds} · next in {Math.max(0, Math.ceil((endsAt - serverNow) / 1000))}s</p>
      <h2 className="reveal-prompt">{prompt.prompt}</h2>

      {!answers ? (
        <p className="muted">Collecting answers…</p>
      ) : (
        <>
          <div className="reveal" style={{ '--tier': color } as CSSProperties}>
            <div className="reveal-badge">
              <span className="reveal-tier">{mine ? TIERS[mine.tier].name : 'Signal lost'}</span>
              <span className="reveal-points">+{mine?.points ?? 0}</span>
            </div>
          </div>

          <div className="room-grid">
            <section className="panel">
              <h3 className="panel-title">Answers</h3>
              <ol className="room-answers">
                {answers.map((a) => (
                  <li key={a.slot} className="room-answer" style={{ '--tier': TIER_COLORS[a.tier] } as CSSProperties}>
                    <span className="room-answer-name">{a.name}{a.slot === you?.slot && <span className="muted"> (you)</span>}</span>
                    <span className="room-answer-text">{displayName(a.matched)}</span>
                    <span className="room-answer-tier">{TIERS[a.tier].name} +{a.points}</span>
                  </li>
                ))}
                {missed.map((p) => (
                  <li key={`m${p.slot}`} className="room-answer room-answer-miss">
                    <span className="room-answer-name">{p.name}</span>
                    <span className="room-answer-text muted">no answer</span>
                    <span className="room-answer-tier">+0</span>
                  </li>
                ))}
              </ol>
              <p className="muted small">Deep-space answers: {rarestExamples(prompt).join(', ')}</p>
            </section>

            <section className="panel">
              <h3 className="panel-title">Standings</h3>
              <Standings players={standings} limit={8} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Standings({ players, limit }: { players: RoomState['players']; limit?: number }) {
  let rank = 0;
  let prev = -1;
  return (
    <ol className="board-list">
      {players.slice(0, limit ?? players.length).map((p, i) => {
        if (p.score !== prev) rank = i + 1;
        prev = p.score;
        return (
          <li key={p.slot} className={`board-row ${p.you ? 'board-you' : ''} ${rank <= 3 ? `board-top board-top-${rank}` : ''}`}>
            <span className="board-rank">#{rank}</span>
            <span className="board-name">{p.name}{p.you && <span className="muted"> (you)</span>}</span>
            <span className="board-score">{p.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- final

function Final({ state, onLeave }: { state: RoomState; onLeave: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const standings = [...state.players].sort((a, b) => b.score - a.score);
  const you = standings.find((p) => p.you);
  const place = you ? standings.filter((p) => p.score > you.score).length + 1 : null;
  const played = useRef(false);

  useEffect(() => {
    if (!played.current && you) {
      played.current = true;
      sfx.results(you.score);
    }
  }, [you]);

  useGSAP(
    () => {
      gsap.from('.results-head > *', { opacity: 0, y: 16, stagger: 0.1, duration: 0.5 });
      gsap.from('.board-row', { opacity: 0, x: -20, stagger: 0.06, duration: 0.35, delay: 0.3 });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <header className="results-head">
        <p className="eyebrow">Room {state.code} · Mission report</p>
        <h1 className="results-total">{place ? `#${place}` : 'Done'}<small> of {standings.length}</small></h1>
        {you && <p className="results-reached">{you.score} pts · reached <b>{landmarkAt(you.score).name}</b></p>}
      </header>
      <section className="panel">
        <h2 className="panel-title">Final standings</h2>
        <Standings players={standings} />
      </section>
      <div className="results-actions">
        <button className="btn btn-primary" onClick={onLeave}>New mission</button>
      </div>
    </div>
  );
}
