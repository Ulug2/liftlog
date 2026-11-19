import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Download, LogOut, RefreshCw, Share, Sparkles, Trash2 } from 'lucide-react';
import { getState, resetLocal, setProfile, useDb } from '../../lib/db';
import { syncConfigured } from '../../lib/supabase';
import { signIn, signOut, signUp, syncNow } from '../../lib/sync';
import { loadSampleData } from '../../lib/sample';
import { workoutIndex } from '../../lib/queries';
import { Field, Segmented, Sheet, Stepper, showToast } from '../../components/ui';
import { fmtRest, fmtRelativeDay } from '../../utils/dates';
import { exportCsv, exportJson } from './exporters';

declare const __APP_VERSION__: string;

export default function SettingsScreen() {
  const db = useDb();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmErase, setConfirmErase] = useState(false);
  const isEmpty = Object.keys(db.tables.routine_days).length === 0 && workoutIndex(db.tables).completed.length === 0;

  useEffect(() => {
    if (location.hash === '#sample') document.getElementById('sample')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" style={{ marginLeft: -12 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <div className="page-title" style={{ flex: 1 }}>
          Settings
        </div>
      </header>

      <section className="settings-group">
        <div className="section-title">Training</div>
        <div className="card stack" style={{ gap: 16 }}>
          <Field label="Weight unit">
            <Segmented
              value={db.profile.weight_unit}
              onChange={(v) => setProfile({ weight_unit: v })}
              options={[
                { value: 'lb', label: 'Pounds (lb)' },
                { value: 'kg', label: 'Kilograms (kg)' },
              ]}
            />
          </Field>
          <p className="faint" style={{ fontSize: 13, marginTop: -8 }}>
            Weights are stored precisely and converted for display — switching never changes your data.
          </p>
          <Field label="Default rest for new exercises">
            <Stepper
              label="default rest"
              value={db.profile.default_rest_seconds}
              step={15}
              min={0}
              max={600}
              format={(v) => (v ? fmtRest(v) : 'Off')}
              onChange={(v) => setProfile({ default_rest_seconds: v })}
            />
          </Field>
        </div>
      </section>

      <section className="settings-group">
        <div className="section-title">Account & sync</div>
        <AccountCard />
      </section>

      <section className="settings-group">
        <div className="section-title">Data</div>
        <div className="list">
          <button className="list-row" onClick={() => exportJson(getState())}>
            <Download size={20} className="muted" />
            <div className="list-row__main">
              <div className="list-row__title">Export backup (JSON)</div>
              <div className="list-row__sub">Everything, restorable later</div>
            </div>
          </button>
          <button className="list-row" onClick={() => exportCsv(getState())}>
            <Share size={20} className="muted" />
            <div className="list-row__main">
              <div className="list-row__title">Export sets (CSV)</div>
              <div className="list-row__sub">One row per set — opens in Numbers / Sheets</div>
            </div>
          </button>
          {isEmpty && (
            <button
              id="sample"
              className="list-row"
              onClick={() => {
                loadSampleData();
                showToast('Sample routine and 6 weeks of history added');
                navigate('/');
              }}
            >
              <Sparkles size={20} className="accent" />
              <div className="list-row__main">
                <div className="list-row__title">Load sample data</div>
                <div className="list-row__sub">A 5-day routine with history, to explore the app</div>
              </div>
            </button>
          )}
          <button className="list-row" onClick={() => setConfirmErase(true)}>
            <Trash2 size={20} style={{ color: 'var(--danger)' }} />
            <div className="list-row__main">
              <div className="list-row__title" style={{ color: 'var(--danger)' }}>Erase data on this device</div>
              <div className="list-row__sub">Removes local routines and history</div>
            </div>
          </button>
        </div>
      </section>

      <section className="settings-group">
        <div className="section-title">Install on iPhone</div>
        <div className="card">
          <ol className="install-steps">
            <li>Open LiftLog in <b>Safari</b>.</li>
            <li>
              Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.
            </li>
            <li>Open it from your Home Screen — it runs full-screen and works offline.</li>
          </ol>
        </div>
      </section>

      <section className="settings-group">
        <div className="section-title">About</div>
        <div className="list">
          <div className="list-row">
            <span className="list-row__main">Version</span>
            <span className="list-row__trail num">{__APP_VERSION__}</span>
          </div>
          <div className="list-row">
            <span className="list-row__main">Local storage</span>
            <span className="list-row__trail">{db.storageKind === 'indexeddb' ? 'IndexedDB' : db.storageKind === 'localstorage' ? 'localStorage' : 'Memory only'}</span>
          </div>
          <div className="list-row">
            <span className="list-row__main">Theme</span>
            <span className="list-row__trail">Dark</span>
          </div>
        </div>
      </section>

      <Sheet open={confirmErase} onClose={() => setConfirmErase(false)} title="Erase all data on this device?">
        <p className="muted" style={{ marginBottom: 16 }}>
          {db.sync.email
            ? 'Your synced data stays in your account and will download again when you sign in.'
            : 'This cannot be undone. Export a backup first if you might want it later.'}
        </p>
        <div className="stack">
          <button
            className="btn btn--danger btn--lg btn--block"
            onClick={async () => {
              if (db.sync.email) await signOut();
              await resetLocal();
              setConfirmErase(false);
              navigate('/');
            }}
          >
            Erase
          </button>
          <button className="btn btn--block" onClick={() => setConfirmErase(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function AccountCard() {
  const db = useDb();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!syncConfigured) {
    return (
      <div className="card">
        <div style={{ fontWeight: 600 }}>On this device only</div>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Everything is saved locally and works offline. Cloud sync turns on once Supabase keys are added (see README).
        </p>
      </div>
    );
  }

  if (db.sync.email) {
    const s = db.sync;
    const status =
      s.status === 'syncing' ? 'Syncing…'
      : s.status === 'offline' ? 'Offline — changes are saved on this device'
      : s.status === 'error' ? `Sync issue: ${s.error ?? 'unknown'}`
      : db.pending > 0 ? `${db.pending} change${db.pending === 1 ? '' : 's'} waiting to sync`
      : s.lastSyncedAt ? `Synced ${fmtRelativeDay(s.lastSyncedAt).toLowerCase()} at ${new Date(s.lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : 'Ready';
    return (
      <div className="list">
        <div className="list-row">
          <div className="list-row__main">
            <div className="list-row__title">{s.email}</div>
            <div className="list-row__sub" style={{ whiteSpace: 'normal' }}>{status}</div>
          </div>
        </div>
        <button className="list-row" onClick={() => void syncNow()}>
          <RefreshCw size={20} className={s.status === 'syncing' ? 'muted spin' : 'muted'} />
          <span className="list-row__main">Sync now</span>
        </button>
        <button className="list-row" onClick={() => void signOut()}>
          <LogOut size={20} className="muted" />
          <span className="list-row__main">Sign out</span>
        </button>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'needsConfirmation' in r && r.needsConfirmation) setMsg('Check your email to confirm the account, then sign in.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void run(() => signIn(email, password)); }}>
      <p className="muted" style={{ fontSize: 14 }}>Sign in to back up and sync across devices. The app keeps working offline either way.</p>
      <input className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      {msg && <p style={{ fontSize: 14, color: 'var(--warn)' }}>{msg}</p>}
      <div className="row">
        <button className="btn btn--primary" style={{ flex: 1 }} disabled={busy}>
          Sign in
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} disabled={busy || !email || password.length < 6} onClick={() => void run(() => signUp(email, password))}>
          Create account
        </button>
      </div>
    </form>
  );
}
