import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../net/api';
import { getProfile, setCallsign } from '../game/storage';
import { MP, isRoomCode } from '../game/multiplayer';
import { CallsignForm } from './parts';

interface Props {
  initialCode?: string;
  onEnter: (code: string) => void;
  onBack: () => void;
}

export function MultiMenu({ initialCode = '', onEnter, onBack }: Props) {
  const [name, setName] = useState(getProfile().name);
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ code: string }>) => {
    setBusy(true);
    setError(null);
    try {
      onEnter((await fn()).code);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (isRoomCode(code)) run(() => api.joinRoom(code, getProfile().id, name));
    else setError('Room codes are 5 letters/numbers');
  };

  return (
    <div className="screen multi">
      <header className="results-head">
        <p className="eyebrow">Up to {MP.maxPlayers} pilots · same prompts · live results</p>
        <h1 className="screen-title">Multiplayer</h1>
      </header>

      <section className="panel">
        {name ? (
          <p className="callsign-current">
            Flying as <b>{name}</b>{' '}
            <button className="link-btn" onClick={() => setName('')}>change</button>
          </p>
        ) : (
          <CallsignForm
            cta="Save"
            onSave={(n) => {
              setCallsign(n);
              setName(n);
            }}
          />
        )}
      </section>

      <div className="home-grid">
        <section className="panel">
          <h2 className="panel-title">Host a mission</h2>
          <p className="muted">Get a room code to share. You launch when everyone's aboard.</p>
          <button className="btn btn-primary" disabled={!name || busy} onClick={() => run(() => api.createRoom(getProfile().id, name))}>
            Create room
          </button>
        </section>

        <section className="panel">
          <h2 className="panel-title">Join a mission</h2>
          <form className="callsign-row" onSubmit={join}>
            <input
              className="answer-input code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              placeholder="CODE"
              aria-label="Room code"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button className="btn" type="submit" disabled={!name || busy || code.length !== 5}>Join</button>
          </form>
        </section>
      </div>

      <p className="q-error" role="alert">{error ?? ' '}</p>

      <div className="results-actions">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
