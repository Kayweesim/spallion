import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { api, errorMessage, type Board } from '../net/api';
import { getProfile } from '../game/storage';
import { todayKey } from '../game/session';

type Scope = 'daily' | 'all';

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<Scope>('daily');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBoard(null);
    setError(null);
    api.leaderboard(scope, getProfile().id).then(
      (b) => alive && setBoard(b),
      (e) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [scope]);

  useGSAP(
    () => {
      if (board) gsap.from('.board-row', { opacity: 0, x: -16, stagger: 0.03, duration: 0.3, ease: 'power2.out' });
    },
    { scope: root, dependencies: [board] },
  );

  const youInTop = board?.entries.some((e) => e.you);

  return (
    <div className="screen leaderboard" ref={root}>
      <header className="results-head">
        <p className="eyebrow">Mission control</p>
        <h1 className="screen-title">Leaderboard</h1>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={scope === 'daily'} className={`tab ${scope === 'daily' ? 'tab-on' : ''}`} onClick={() => setScope('daily')}>
          Today · {todayKey()}
        </button>
        <button role="tab" aria-selected={scope === 'all'} className={`tab ${scope === 'all' ? 'tab-on' : ''}`} onClick={() => setScope('all')}>
          All-time
        </button>
      </div>

      <section className="panel board">
        {error && <p className="q-error">{error}</p>}
        {!error && !board && <p className="muted">Receiving transmission…</p>}
        {board && board.entries.length === 0 && (
          <p className="muted">No scores yet. Fly today's daily mission to claim the top spot.</p>
        )}
        {board && board.entries.length > 0 && (
          <>
            <p className="muted board-total">
              {board.total} pilot{board.total === 1 ? '' : 's'}
              {scope === 'all' && ' · total points across every daily mission'}
            </p>
            <ol className="board-list">
              {board.entries.map((e, i) => (
                <li key={i} className={`board-row ${e.you ? 'board-you' : ''} ${e.rank <= 3 ? `board-top board-top-${e.rank}` : ''}`}>
                  <span className="board-rank">#{e.rank}</span>
                  <span className="board-name">{e.name}{e.you && <span className="muted"> (you)</span>}</span>
                  {scope === 'all' && <span className="board-meta muted">{e.days}d · best {e.best}</span>}
                  <span className="board-score">{e.score}</span>
                </li>
              ))}
              {board.you && !youInTop && (
                <li className="board-row board-you board-gap">
                  <span className="board-rank">#{board.you.rank}</span>
                  <span className="board-name">{board.you.name}<span className="muted"> (you)</span></span>
                  {scope === 'all' && <span className="board-meta muted">{board.you.days}d · best {board.you.best}</span>}
                  <span className="board-score">{board.you.score}</span>
                </li>
              )}
            </ol>
          </>
        )}
      </section>

      <div className="results-actions">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
