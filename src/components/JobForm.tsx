import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { api } from '../api';
import { go, useStore } from '../store';
import { STATUS_LABEL, type JobStatus } from '../types';
import { Kbd, Modal } from './Modal';

/** New job needs only Job #, Client and Project. Also used for editing. */
export function JobForm() {
  const { jobForm, closeJobForm, refresh, startJob, toast } = useStore();
  const editing = jobForm.job;
  const [f, setF] = useState({ job_number: '', client: '', project_name: '', notes: '', status: 'active' as JobStatus });
  const [clients, setClients] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!jobForm.open) return;
    const j = jobForm.job;
    setF(j
      ? { job_number: j.job_number, client: j.client, project_name: j.project_name, notes: j.notes, status: j.status }
      : { job_number: jobForm.prefill ?? '', client: '', project_name: '', notes: '', status: 'active' });
    setError('');
    api.clients().then((c) => setClients(c.map((x) => x.name))).catch(() => {});
  }, [jobForm]);

  if (!jobForm.open) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const submit = async (andStart: boolean) => {
    if (!f.job_number.trim() || !f.client.trim() || !f.project_name.trim()) {
      setError('Job #, client and project name are required.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateJob(editing.id, f);
        await refresh();
        closeJobForm();
        toast('Job updated');
      } else {
        const job = await api.createJob(f);
        await refresh();
        closeJobForm();
        if (andStart) startJob(job.id);
        else go(`jobs/${job.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement && !e.ctrlKey)) {
      e.preventDefault();
      void submit(!editing && !e.shiftKey);
    }
  };

  return (
    <Modal
      title={editing ? `Edit job #${editing.job_number}` : 'New job'}
      sub={editing ? undefined : 'Only job #, client and project are needed. Everything else can wait.'}
      onClose={closeJobForm}
      footer={
        <>
          {error && <span className="error-text">{error}</span>}
          <div className="spacer" />
          {editing ? (
            <>
              <button className="btn" onClick={closeJobForm}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={() => void submit(false)}>Save <Kbd>↵</Kbd></button>
            </>
          ) : (
            <>
              <button className="btn" disabled={saving} onClick={() => void submit(false)} title="Shift+Enter">Create</button>
              <button className="btn primary" disabled={saving} onClick={() => void submit(true)}>
                <Play size={14} fill="currentColor" /> Create & Start Timer <Kbd>↵</Kbd>
              </button>
            </>
          )}
        </>
      }
    >
      <div className="modal-body" onKeyDown={onKey}>
        <div className="form-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
          <div className="field">
            <label htmlFor="jf-num">Job #</label>
            <input id="jf-num" className="input mono" data-autofocus value={f.job_number} onChange={set('job_number')} placeholder="2941" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="jf-client">Client / company</label>
            <input id="jf-client" className="input" list="jf-clients" value={f.client} onChange={set('client')} placeholder="ABC Plumbing" autoComplete="off" />
            <datalist id="jf-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="jf-project">Project name</label>
          <input id="jf-project" className="input" value={f.project_name} onChange={set('project_name')} placeholder="Ford Transit Full Wrap" autoComplete="off" />
        </div>
        <div className="form-grid" style={{ marginTop: 12, gridTemplateColumns: editing ? '1fr 160px' : '1fr' }}>
          <div className="field">
            <label htmlFor="jf-notes">Notes <span className="faint">(optional)</span></label>
            <textarea id="jf-notes" className="textarea" rows={2} value={f.notes} onChange={set('notes')} />
          </div>
          {editing && (
            <div className="field">
              <label htmlFor="jf-status">Status</label>
              <select id="jf-status" className="select" value={f.status} onChange={set('status')}>
                {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
