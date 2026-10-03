import { useEffect, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { MISS_EMOJI, TIERS, TIER_COLORS, TIER_EMOJI, displayName, getPrompt, rarestExamples } from '../game/data';
import { landmarkAt } from '../game/landmarks';
import { sfx } from '../audio/sfx';
import { getProfile, setCallsign } from '../game/storage';
import { api, errorMessage, type DailyPostResult } from '../net/api';
import { CallsignForm } from './parts';
import { MAX_SCORE, type Mode, type RoundResult } from '../game/types';

interface Props {
  mode: Mode;
  date: string;
  rounds: RoundResult[];
  onHome: () => void;
  onUnlimited: () => void;
  onLeaderboard: () => void;
}

export function Results({ mode, date, rounds, onHome, onUnlimited, onLeaderboard }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const fanfare = useRef(false);
  const total = rounds.reduce((n, r) => n + r.points, 0);
  const reached = landmarkAt(total);

  useGSAP(
    () => {
      if (!fanfare.current) {
        fanfare.current = true; // StrictMode runs this twice in dev
        sfx.results(total);
      }
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.results-head > *', { opacity: 0, y: 16, stagger: 0.1, duration: 0.5 })
        .from('.results-total-num', { innerText: 0, snap: { innerText: 1 }, duration: 1.4, ease: 'power2.out' }, 0.1)
        .from('.log-row', { opacity: 0, x: -20, stagger: 0.07, duration: 0.4 }, 0.4)
        .from('.results-actions .btn', { opacity: 0, y: 10, stagger: 0.08, duration: 0.35 }, '-=0.2');
    },
    { scope: root },
  );

  const share = async () => {
    const grid = rounds.map((r) => (r.tier ? TIER_EMOJI[r.tier] : MISS_EMOJI)).join('');
    const label = mode === 'daily' ? `Daily ${date}` : 'Unlimited';
    const text = `SPALLION ${label}\n🚀 ${total}/${MAX_SCORE} · ${reached.name}\n${grid}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy your mission log:', text);
    }
  };

  return (
    <div className="screen results" ref={root}>
      <header className="results-head">
        <p className="eyebrow">{mode === 'daily' ? `Daily mission · ${date}` : 'Unlimited flight'} · Mission report</p>
        <h1 className="results-total">
          <span className="results-total-num">{total}</span>
          <small> / {MAX_SCORE} pts</small>
        </h1>
        <p className="results-reached">Reached <b>{reached.name}</b></p>
      </header>

      <ol className="log panel">
        {rounds.map((r, i) => {
          const p = getPrompt(r.promptId);
          const color = r.tier ? TIER_COLORS[r.tier] : 'var(--danger)';
          return (
            <li className="log-row" key={r.promptId} style={{ '--tier': color } as CSSProperties}>
              <span className="log-num">{String(i + 1).padStart(2, '0')}</span>
              <div className="log-body">
                <p className="log-prompt">{p?.prompt ?? r.promptId}</p>
                <p className="log-answer">
                  {r.matched ? displayName(r.matched) : <span className="muted">no answer</span>}
                </p>
                {p && <p className="log-rare muted">Rarest: {rarestExamples(p).join(', ')}</p>}
              </div>
              <span className="log-tier">
                {r.tier ? TIERS[r.tier].name : 'Lost'}
                <b>+{r.points}</b>
              </span>
            </li>
          );
        })}
      </ol>

      {mode === 'daily' && <PostScore date={date} rounds={rounds} onLeaderboard={onLeaderboard} />}

      <div className="results-actions">
        <button className="btn btn-primary" onClick={share}>{copied ? 'Copied ✓' : 'Share log'}</button>
        <button className="btn" onClick={onUnlimited}>Fly unlimited</button>
        <button className="btn btn-ghost" onClick={onHome}>Home</button>
      </div>
    </div>
  );
}

/** Sends the daily run to the leaderboard (the server re-scores it) and shows your rank. */
function PostScore({ date, rounds, onLeaderboard }: { date: string; rounds: RoundResult[]; onLeaderboard: () => void }) {
  const [name, setName] = useState(getProfile().name);
  const [result, setResult] = useState<DailyPostResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    let alive = true;
    setError(null);
    api
      .postDaily({ playerId: getProfile().id, name, day: date, guesses: rounds.map((r) => (r.matched ? r.answer : null)) })
      .then((res) => alive && setResult(res), (e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [name, date, rounds]);

  return (
    <section className="panel post-score">
      {!name ? (
        <>
          <h2 className="panel-title">Post to the leaderboard</h2>
          <CallsignForm
            cta="Post score"
            onSave={(n) => {
              setCallsign(n);
              setName(n);
            }}
          />
        </>
      ) : error ? (
        <p className="q-error">{error}</p>
      ) : !result ? (
        <p className="muted">Transmitting to mission control…</p>
      ) : (
        <div className="post-score-row">
          <p>
            <b className="rank-big">#{result.rank}</b> of {result.total} pilots today
            <span className="muted"> · as {name}</span>
          </p>
          <button className="btn btn-small" onClick={onLeaderboard}>Leaderboard</button>
        </div>
      )}
    </section>
  );
}
