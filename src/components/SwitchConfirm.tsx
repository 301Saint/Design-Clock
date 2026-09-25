import { useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useNow, useStore } from '../store';
import { fmtClock } from '../lib/time';
import { Kbd, Modal } from './Modal';

export function SwitchConfirm() {
  const { switchPrompt: job, running, confirmSwitch, saveSettings } = useStore();
  const [dontAsk, setDontAsk] = useState(false);
  const now = useNow(1000);
  if (!job || !running) return null;

  const ok = () => {
    if (dontAsk) void saveSettings({ confirmSwitch: false });
    confirmSwitch(true);
  };

  return (
    <Modal
      title="Stop the current timer and start this job?"
      onClose={() => confirmSwitch(false)}
      footer={
        <>
          <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don’t ask again
          </label>
          <div className="spacer" />
          <button className="btn" onClick={() => confirmSwitch(false)}>Cancel</button>
          <button className="btn primary" data-autofocus onClick={ok}>Switch <Kbd>↵</Kbd></button>
        </>
      }
    >
      <div className="modal-body" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }}>
        <div className="row" style={{ cursor: 'default', background: 'var(--stop-soft)' }}>
          <div className="grow">
            <div className="title"><span className="mono jobnum">#{running.job_number}</span> {running.client}</div>
            <div className="sub">{running.project_name}</div>
          </div>
          <span className="mono dur">{fmtClock((now - running.start_at) / 1000 - running.idle_sec)}</span>
          <span className="chip">Stop</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', padding: 4, color: 'var(--text-3)' }}><ArrowDown size={16} /></div>
        <div className="row" style={{ cursor: 'default', background: 'var(--go-soft)' }}>
          <div className="grow">
            <div className="title"><span className="mono jobnum">#{job.job_number}</span> {job.client}</div>
            <div className="sub">{job.project_name}</div>
          </div>
          <span className="chip">Start</span>
        </div>
      </div>
    </Modal>
  );
}
