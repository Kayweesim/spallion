import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { SpaceScene } from './scene/SpaceScene';
import { sfx } from './audio/sfx';
import { Home } from './components/Home';
import { Play } from './components/Play';
import { Results } from './components/Results';
import { Leaderboard } from './components/Leaderboard';
import { MultiMenu } from './components/MultiMenu';
import { MultiRoom } from './components/MultiRoom';
import { pickPrompts, todayKey } from './game/session';
import { getLastUnlimited, getTodaysDaily, recordGame } from './game/storage';
import type { Mode, Prompt, RoundResult } from './game/types';

type Screen =
  | { name: 'home' }
  | { name: 'play'; mode: Mode; day: string; prompts: Prompt[]; run: number }
  | { name: 'results'; mode: Mode; day: string; rounds: RoundResult[] }
  | { name: 'leaderboard'; back: Screen }
  | { name: 'multi-menu'; code?: string }
  | { name: 'multi-room'; code: string };

/** ?room=CODE invite links open straight into the join screen. */
function initialScreen(): Screen {
  const code = new URLSearchParams(location.search).get('room');
  return code ? { name: 'multi-menu', code } : { name: 'home' };
}

function setRoomParam(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<SpaceScene | null>(null);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [muted, setMuted] = useState(sfx.isMuted());

  useEffect(() => {
    const s = new SpaceScene(canvasRef.current!);
    setScene(s);
    // Dev only: ?fly=120 launches straight to that score, for checking the scene.
    const fly = Number(new URLSearchParams(location.search).get('fly'));
    if (import.meta.env.DEV && fly > 0) {
      gsap.ticker.lagSmoothing(0); // headless screenshots advance time in big jumps
      s.flyTo(fly);
    }
    return () => s.dispose();
  }, []);

  // UI click blips for every neon button.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      sfx.unlock();
      if ((e.target as HTMLElement).closest('.btn')) sfx.click();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const toggleMute = () => {
    sfx.setMuted(!muted);
    setMuted(!muted);
  };

  const start = (mode: Mode) => {
    if (mode === 'daily') {
      const done = getTodaysDaily();
      if (done) {
        const total = done.reduce((n, r) => n + r.points, 0);
        scene?.flyTo(total);
        setScreen({ name: 'results', mode, day: todayKey(), rounds: done });
        return;
      }
    }
    scene?.reset();
    setScreen({ name: 'play', mode, day: todayKey(), prompts: pickPrompts(mode, getLastUnlimited()), run: Date.now() });
  };

  const finish = (mode: Mode, day: string, rounds: RoundResult[]) => {
    recordGame(mode, rounds, day);
    setScreen({ name: 'results', mode, day, rounds });
  };

  const home = () => {
    scene?.reset();
    setRoomParam(null);
    setScreen({ name: 'home' });
  };

  const leaveRoom = () => {
    scene?.reset();
    setRoomParam(null);
    setScreen({ name: 'multi-menu' });
  };

  const enterRoom = (code: string) => {
    scene?.reset();
    setRoomParam(code);
    setScreen({ name: 'multi-room', code });
  };

  return (
    <>
      <canvas ref={canvasRef} className="space" aria-hidden="true" />
      <div className="crt" aria-hidden="true" />
      <main className="ui">
        {screen.name === 'home' && (
          <Home
            onStart={start}
            onMultiplayer={() => setScreen({ name: 'multi-menu' })}
            onLeaderboard={() => setScreen({ name: 'leaderboard', back: screen })}
          />
        )}
        {screen.name === 'play' && (
          <Play
            key={screen.run}
            mode={screen.mode}
            prompts={screen.prompts}
            scene={scene}
            onDone={(rounds) => finish(screen.mode, screen.day, rounds)}
            onQuit={home}
          />
        )}
        {screen.name === 'results' && (
          <Results
            mode={screen.mode}
            date={screen.day}
            rounds={screen.rounds}
            onHome={home}
            onUnlimited={() => start('unlimited')}
            onLeaderboard={() => setScreen({ name: 'leaderboard', back: screen })}
          />
        )}
        {screen.name === 'leaderboard' && <Leaderboard onBack={() => setScreen(screen.back)} />}
        {screen.name === 'multi-menu' && <MultiMenu initialCode={screen.code} onEnter={enterRoom} onBack={home} />}
        {screen.name === 'multi-room' && (
          <MultiRoom key={screen.code} code={screen.code} scene={scene} onLeave={leaveRoom} />
        )}
      </main>
      <button
        className="mute-toggle"
        onClick={toggleMute}
        aria-pressed={!muted}
        aria-label={muted ? 'Turn sound effects on' : 'Turn sound effects off'}
      >
        SFX {muted ? 'off' : 'on'}
      </button>
    </>
  );
}
