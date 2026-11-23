import { useState } from 'react';
import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { disableNotifications, enableNotifications, sendTestNotification, useNotifyStatus } from '../../lib/notify';

export function NotificationsCard() {
  const status = useNotifyStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    const r = await enableNotifications();
    setBusy(false);
    setMsg(r.ok ? 'On. Lock your phone during a rest to try it.' : r.message ?? null);
  };

  if (status === 'unsupported') {
    return (
      <div className="card muted" style={{ fontSize: 14 }}>
        This browser doesn’t support notifications.
      </div>
    );
  }

  if (status === 'needs-install') {
    return (
      <div className="card row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <Smartphone size={20} className="muted" style={{ flex: 'none', marginTop: 2 }} />
        <p className="muted" style={{ fontSize: 14 }}>
          On iPhone, notifications only work in the installed app. Add LiftLog to your Home Screen (Share → Add to Home Screen), open it from there, and turn this on.
        </p>
      </div>
    );
  }

  return (
    <div className="list">
      <div className="list-row" style={{ alignItems: 'flex-start' }}>
        {status === 'on' ? <BellRing size={20} style={{ marginTop: 2 }} /> : status === 'denied' ? <BellOff size={20} className="muted" style={{ marginTop: 2 }} /> : <Bell size={20} className="muted" style={{ marginTop: 2 }} />}
        <div className="list-row__main">
          <div className="list-row__title">Rest-over alert</div>
          <div className="list-row__sub" style={{ whiteSpace: 'normal' }}>
            {status === 'on'
              ? 'On. You’ll get one alert when your rest is over (only while LiftLog isn’t open). Tap it to go back to your workout.'
              : status === 'denied'
                ? 'Blocked. Allow them in iPhone Settings → Notifications → LiftLog.'
                : 'Get one alert when your rest is over, even with the phone locked.'}
          </div>
          {msg && (
            <div className="list-row__sub" style={{ whiteSpace: 'normal', color: 'var(--text)', marginTop: 6 }}>
              {msg}
            </div>
          )}
        </div>
      </div>
      {status === 'off' && (
        <button className="list-row" onClick={turnOn} disabled={busy}>
          <span className="list-row__main" style={{ fontWeight: 600 }}>
            {busy ? 'Turning on…' : 'Turn on'}
          </span>
        </button>
      )}
      {status === 'on' && (
        <>
          <button className="list-row" onClick={() => { void sendTestNotification(); setMsg('Test sent. Lock your phone if it doesn’t show right away.'); }}>
            <span className="list-row__main">Send a test alert</span>
          </button>
          <button className="list-row" onClick={() => { void disableNotifications(); setMsg(null); }}>
            <span className="list-row__main" style={{ color: 'var(--danger)' }}>Turn off</span>
          </button>
        </>
      )}
    </div>
  );
}
