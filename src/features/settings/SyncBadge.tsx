import { Link } from 'react-router-dom';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useDb } from '../../lib/db';

/** Subtle indicator, only visible when there's something worth knowing. */
export function SyncBadge() {
  const { sync, pending } = useDb();
  if (sync.status === 'local' || (sync.status === 'idle' && pending === 0)) return null;
  const label =
    sync.status === 'syncing' ? 'Syncing' : sync.status === 'offline' ? 'Offline — saved on device' : sync.status === 'error' ? 'Sync issue' : `${pending} unsynced`;
  return (
    <Link to="/settings" className="icon-btn" aria-label={label} title={label}>
      {sync.status === 'syncing' ? (
        <RefreshCw size={18} className="spin" />
      ) : (
        <CloudOff size={18} style={{ color: sync.status === 'error' ? 'var(--warn)' : undefined }} />
      )}
    </Link>
  );
}
