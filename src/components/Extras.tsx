import { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { fmtDur } from '../lib/time';
import { Kbd, Modal } from './Modal';

/** Polls the local idle monitor while a timer runs (only when enabled in Settings). */
export function IdlePrompt() {
  const { settings, running, refresh, fail } = useStore();
  const [prompt, setPrompt] = useState<{ seconds: number; sessionId: number } | null>(null);

  useEffect(() => {
    if (!settings.idleDetection || !running) { setPrompt(null); return; }
    let alive = true;
    const check = () => api.idle().then((r) => { if (alive && r.prompt) setPrompt(r.prompt); }).catch(() => {});
    check();
    const t = setInterval(check, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [settings.idleDetection, running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prompt) return null;
  const resolve = async (action: 'keep' | 'remove') => {
    try {
      await api.resolveIdle(prompt.sessionId, action, prompt.seconds);
      setPrompt(null);
      await refresh();
    } catch (e) { fail(e); }
  };
  return (
    <Modal
      title={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Moon size={17} /> Welcome back</span>}
      onClose={() => void resolve('keep')}
      closeOnBackdrop={false}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={() => void resolve('keep')}>Keep idle time</button>
          <button className="btn primary" data-autofocus onClick={() => void resolve('remove')}>Remove idle time</button>
        </>
      }
    >
      <div className="modal-body">
        You appear to have been inactive for <b>{fmtDur(prompt.seconds)}</b>.
        {running && <> The timer for <span className="mono jobnum">#{running.job_number}</span> kept running.</>}
      </div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ['Start / stop timer (last or open job)', ['Space']],
  ['Start / stop timer (works while typing)', ['Alt', 'S']],
  ['Search jobs', ['Ctrl', 'K']],
  ['Search jobs', ['/']],
  ['Start a job (search in start mode)', ['Alt', 'J']],
  ['New job', ['N']],
  ['New job', ['Alt', 'N']],
  ['Add time manually', ['M']],
  ['Dashboard · Jobs · Reports · Analytics · Settings', ['Alt', '1…5']],
  ['In “What did you work on?”: pick category', ['1…9']],
  ['Save / confirm', ['Enter']],
  ['Close / label later', ['Esc']],
  ['Show shortcuts', ['?']],
];

export function ShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useStore();
  if (!helpOpen) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelpOpen(false)}>
      <div className="modal-body">
        <div className="shortcut-list">
          {SHORTCUTS.map(([label, keys], i) => (
            <div key={i} style={{ display: 'contents' }}>
              <span className="muted">{label}</span>
              <span className="keys">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </div>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Ctrl+N also works where the browser allows it. Single-letter shortcuts are ignored while you’re typing in a field.
        </p>
      </div>
    </Modal>
  );
}
