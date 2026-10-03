import { useRef, useState, type FormEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Prompt heading that "decodes" in whenever the text changes. */
export function PromptText({ text }: { text: string }) {
  const el = useRef<HTMLHeadingElement>(null);
  useGSAP(
    () => {
      if (!el.current) return;
      if (reducedMotion()) {
        el.current.textContent = text;
        return;
      }
      gsap.to(el.current, {
        duration: 0.9,
        scrambleText: { text, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/', speed: 0.8 },
      });
    },
    { dependencies: [text] },
  );
  // Keyed so each prompt starts from an empty element; GSAP owns the text inside.
  return <h2 className="q-prompt" ref={el} key={text} aria-label={text} />;
}

export function TimerBar({ left, total }: { left: number; total: number }) {
  const urgent = left <= 5;
  return (
    <div className={`timer ${urgent ? 'timer-urgent' : ''}`} role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
      <div className="timer-fill" style={{ transform: `scaleX(${Math.max(0, left / total)})` }} />
      <span className="timer-num">{Math.ceil(left)}</span>
    </div>
  );
}

export function CallsignForm({ initial = '', cta, onSave }: { initial?: string; cta: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const clean = name.replace(/\s+/g, ' ').trim();
  const valid = clean.length >= 2 && clean.length <= 16;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSave(clean);
  };
  return (
    <form className="callsign-form" onSubmit={submit}>
      <label className="callsign-label" htmlFor="callsign">Callsign</label>
      <div className="callsign-row">
        <input
          id="callsign"
          className="answer-input"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          placeholder="2–16 characters"
          autoComplete="nickname"
          spellCheck={false}
        />
        <button className="btn btn-primary" type="submit" disabled={!valid}>{cta}</button>
      </div>
    </form>
  );
}
