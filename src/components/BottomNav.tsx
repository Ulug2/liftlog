import { NavLink, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Dumbbell, House, TrendingUp } from 'lucide-react';
import { useDb } from '../lib/db';
import { liveElapsedSeconds, workoutIndex } from '../lib/queries';
import { fmtDuration } from '../utils/dates';
import { useNow } from './ui';

const TABS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/routine', label: 'Routine', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/history', label: 'History', icon: CalendarDays },
];

export function BottomNav() {
  const db = useDb();
  const active = workoutIndex(db.tables).active;
  const now = useNow(1000, !!active);
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav">
      {active && (
        <button className="resume-bar" onClick={() => navigate('/workout')}>
          <span className="resume-bar__dot" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{active.workout_name_snapshot}</span>
            <span className="muted"> · {active.paused_at ? 'Paused' : 'In progress'}</span>
          </span>
          <span className="num accent" style={{ fontWeight: 600 }}>
            {fmtDuration(liveElapsedSeconds(active, now))}
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      )}
      <div className="bottom-nav__inner">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={22} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
