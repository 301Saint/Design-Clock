import { useEffect } from 'react';
import { BarChart3, Briefcase, Clock3, Keyboard, LayoutDashboard, LineChart, Settings as SettingsIcon } from 'lucide-react';
import { go, useHashRoute, useStore } from './store';
import { TimerBar } from './components/TimerBar';
import { LabelModal } from './components/LabelModal';
import { SwitchConfirm } from './components/SwitchConfirm';
import { JobForm } from './components/JobForm';
import { SearchPalette } from './components/SearchPalette';
import { SessionModal } from './components/SessionModal';
import { IdlePrompt, ShortcutsHelp, Toasts } from './components/Extras';
import { Kbd } from './components/Modal';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { JobDetail } from './pages/JobDetail';
import { Reports } from './pages/Reports';
import { Analytics } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'jobs', label: 'Jobs', icon: Briefcase },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'analytics', label: 'Analytics', icon: LineChart },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function useHotkeys() {
  const store = useStore();
  const { toggleTimer, openSearch, openJobForm, openSession, setHelpOpen, focusJobId, running } = store;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modalOpen = !!document.querySelector('.overlay');
      const key = e.key.toLowerCase();

      // Chords that work anywhere (except inside dialogs, which have their own keys)
      if (!modalOpen && (e.ctrlKey || e.metaKey) && !e.altKey && key === 'k') { e.preventDefault(); openSearch('open'); return; }
      if (!modalOpen && (e.ctrlKey || e.metaKey) && !e.altKey && key === 'n') { e.preventDefault(); openJobForm(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (modalOpen) return;
        if (key === 's') { e.preventDefault(); toggleTimer(); return; }
        if (key === 'n') { e.preventDefault(); openJobForm(); return; }
        if (key === 'j') { e.preventDefault(); openSearch('start'); return; }
        const n = Number(e.key);
        if (n >= 1 && n <= NAV.length) { e.preventDefault(); go(NAV[n - 1].key); return; }
      }
      if (modalOpen || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;

      if (e.key === ' ') {
        // Space on a focused button should click the button, not toggle the timer.
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute('role') === 'switch')) return;
        e.preventDefault();
        toggleTimer();
      } else if (e.key === '/') { e.preventDefault(); openSearch('open'); }
      else if (key === 'n') { e.preventDefault(); openJobForm(); }
      else if (key === 'm') { e.preventDefault(); openSession({ jobId: running?.job_id ?? focusJobId ?? undefined }); }
      else if (e.key === '?') { e.preventDefault(); setHelpOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTimer, openSearch, openJobForm, openSession, setHelpOpen, focusJobId, running]);
}

export function App() {
  const { ready, setHelpOpen } = useStore();
  const route = useHashRoute();
  useHotkeys();
  const [page, id] = route;

  let body;
  if (page === 'jobs' && id) body = <JobDetail id={Number(id)} />;
  else if (page === 'jobs') body = <Jobs />;
  else if (page === 'reports') body = <Reports />;
  else if (page === 'analytics') body = <Analytics />;
  else if (page === 'settings') body = <SettingsPage />;
  else body = <Dashboard />;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark"><Clock3 size={16} strokeWidth={2.4} /></span>
          Design Clock
        </div>
        {NAV.map((n, i) => {
          const Icon = n.icon;
          const active = page === n.key || (n.key === 'dashboard' && !NAV.some((x) => x.key === page));
          return (
            <button key={n.key} className={`nav-item ${active ? 'active' : ''}`} onClick={() => go(n.key)} title={`${n.label} (Alt+${i + 1})`}>
              <Icon size={16} /> <span className="label">{n.label}</span>
            </button>
          );
        })}
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            <Keyboard size={16} /> <span className="label">Shortcuts</span> <Kbd>?</Kbd>
          </button>
        </div>
      </nav>
      <div className="main">
        <TimerBar />
        <main className="content">{ready ? body : <div className="page empty">Loading…</div>}</main>
      </div>
      <SearchPalette />
      <JobForm />
      <SessionModal />
      <SwitchConfirm />
      <IdlePrompt />
      <LabelModal />
      <ShortcutsHelp />
      <Toasts />
    </div>
  );
}
