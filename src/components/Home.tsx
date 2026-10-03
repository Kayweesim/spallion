import { useRef, type CSSProperties } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { TIERS, TIER_COLORS } from '../game/data';
import { getStats, getTodaysDaily } from '../game/storage';
import { MAX_SCORE, TIER_ORDER, type Mode } from '../game/types';

interface HomeProps {
  onStart: (mode: Mode) => void;
  onMultiplayer: () => void;
  onLeaderboard: () => void;
}

export function Home({ onStart, onMultiplayer, onLeaderboard }: HomeProps) {
  const root = useRef<HTMLDivElement>(null);
  const dailyDone = getTodaysDaily() !== null;
  const { streak, best } = getStats();

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.title-letter', { yPercent: 120, opacity: 0, stagger: 0.06, duration: 0.7 })
        .from('.tagline', { opacity: 0, y: 10, duration: 0.5 }, '-=0.3')
        .from('.home-actions .btn', { opacity: 0, y: 16, stagger: 0.1, duration: 0.45 }, '-=0.2')
        .from('.panel', { opacity: 0, y: 20, stagger: 0.1, duration: 0.5 }, '-=0.2');
      // Occasional glitch flicker on the logo.
      gsap.to('.title', {
        keyframes: [{ skewX: 12, x: -4, duration: 0.05 }, { skewX: -6, x: 3, duration: 0.05 }, { skewX: 0, x: 0, duration: 0.05 }],
        repeat: -1,
        repeatDelay: 3.5,
        delay: 2,
      });
    },
    { scope: root },
  );

  return (
    <div className="screen home" ref={root}>
      <header className="brand">
        <h1 className="title" aria-label="Spallion">
          {'SPALLION'.split('').map((ch, i) => (
            <span className="title-letter" key={i} aria-hidden="true">{ch}</span>
          ))}
        </h1>
        <p className="tagline">Give the rarest right answer. Fly the furthest.</p>
      </header>

      <div className="home-actions">
        <button className="btn btn-primary" onClick={() => onStart('daily')}>
          {dailyDone ? 'Daily complete · View log' : 'Launch daily mission'}
        </button>
        <button className="btn" onClick={() => onStart('unlimited')}>Unlimited flight</button>
        <button className="btn" onClick={onMultiplayer}>Multiplayer</button>
        <button className="btn btn-ghost" onClick={onLeaderboard}>Leaderboard</button>
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2 className="panel-title">Flight manual</h2>
          <ol className="manual">
            <li>7 prompts per mission. Type any correct answer before the timer runs out.</li>
            <li>Common answers barely clear the launch pad. <b>Rare</b> answers burn hard into deep space.</li>
            <li>Not recognised? Try another answer. The clock keeps running.</li>
            <li>Max range: {MAX_SCORE} pts, the Galactic Core.</li>
          </ol>
        </section>

        <section className="panel">
          <h2 className="panel-title">Rarity scale</h2>
          <ul className="tier-list">
            {TIER_ORDER.map((id) => (
              <li key={id} style={{ '--tier': TIER_COLORS[id] } as CSSProperties}>
                <span className="tier-name">{TIERS[id].name}</span>
                <span className="tier-pts">+{TIERS[id].points}</span>
                <span className="tier-blurb">{TIERS[id].blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="stats">
        <span>Streak <b>{streak}</b></span>
        <span>Best range <b>{best}</b> pts</span>
      </footer>
    </div>
  );
}
