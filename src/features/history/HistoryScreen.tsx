import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Moon, SkipForward, Trash2 } from 'lucide-react';
import { useDb } from '../../lib/db';
import { alive, dayStatus, exercisesPerformed, sessionSummary, workoutIndex } from '../../lib/queries';
import { clearDayLog, skipReasonLabel } from '../../lib/actions';
import { addDays, dateFromKey, fmtDate, fmtDurationShort, localDateKey, startOfWeek } from '../../utils/dates';
import { ActionSheet, EmptyState } from '../../components/ui';
import type { DayLog, WorkoutSession } from '../../types/models';

type Entry = { kind: 'session'; date: string; session: WorkoutSession } | { kind: 'log'; date: string; log: DayLog };

export function HistoryScreen() {
  const db = useDb();
  const navigate = useNavigate();
  const idx = workoutIndex(db.tables);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [slide, setSlide] = useState<'' | 'slide-next' | 'slide-prev'>('');
  const [logMenu, setLogMenu] = useState<DayLog | null>(null);
  const todayKey = localDateKey();

  const cells = useMemo(() => {
    const start = startOfWeek(month);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const offset = (month.getDay() + 6) % 7;
    const total = Math.ceil((offset + daysInMonth) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const d = addDays(start, i);
      return { key: localDateKey(d), day: d.getDate(), inMonth: d.getMonth() === month.getMonth() };
    });
  }, [month]);

  const monthPrefix = localDateKey(month).slice(0, 7);
  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = [
      ...idx.completed.map((s) => ({ kind: 'session' as const, date: localDateKey(s.started_at), session: s })),
      ...alive(db.tables.day_logs).map((l) => ({ kind: 'log' as const, date: l.log_date, log: l })),
    ];
    return list
      .filter((e) => (selected ? e.date === selected : e.date.startsWith(monthPrefix)))
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const ta = a.kind === 'session' ? a.session.started_at : a.log.created_at;
        const tb = b.kind === 'session' ? b.session.started_at : b.log.created_at;
        return tb.localeCompare(ta);
      });
  }, [idx, db.tables.day_logs, selected, monthPrefix]);

  const monthCount = idx.completed.filter((s) => localDateKey(s.started_at).startsWith(monthPrefix)).length;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title">History</div>
      </header>

      <div className="card calendar">
        <div className="calendar__head">
          <button className="icon-btn" aria-label="Previous month" onClick={() => { setSelected(null); setSlide('slide-prev'); setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }}>
            <ChevronLeft size={20} />
          </button>
          <div className="calendar__title">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            <span className="faint"> · {monthCount} {monthCount === 1 ? 'workout' : 'workouts'}</span>
          </div>
          <button className="icon-btn" aria-label="Next month" onClick={() => { setSelected(null); setSlide('slide-next'); setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); }}>
            <ChevronRight size={20} />
          </button>
        </div>
        <div className={`calendar__grid ${slide}`} key={monthPrefix}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="calendar__dow">
              {d}
            </span>
          ))}
          {cells.map((c) => {
            const status = dayStatus(idx, c.key);
            const cls = ['cal-day', `cal-day--${status}`, !c.inMonth && 'is-out', c.key === todayKey && 'is-today', c.key === selected && 'is-selected', c.key > todayKey && 'is-future']
              .filter(Boolean)
              .join(' ');
            return (
              <button key={c.key} className={cls} onClick={() => setSelected(selected === c.key ? null : c.key)} aria-label={`${c.key} ${status}`}>
                <span className="cal-day__num num">{c.day}</span>
                <span className="cal-day__mark" />
              </button>
            );
          })}
        </div>
        <div className="calendar__legend">
          <span><i className="lg lg--completed" /> Workout</span>
          <span><i className="lg lg--skipped" /> Skipped</span>
          <span><i className="lg lg--rest" /> Rest</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="section-title">{selected ? fmtDate(dateFromKey(selected), { weekday: 'long', month: 'long', day: 'numeric' }) : 'This month'}</span>
          {selected && (
            <button className="text-btn" style={{ minHeight: 0, fontSize: 14 }} onClick={() => setSelected(null)}>
              Show month
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Moon size={22} />} title="Nothing recorded">
              {selected ? 'No activity on this day.' : 'Completed workouts, skips and rest days show up here.'}
            </EmptyState>
          </div>
        ) : (
          <div className="list stagger" key={selected ?? monthPrefix}>
            {entries.map((e) =>
              e.kind === 'session' ? (
                <SessionRow key={e.session.id} session={e.session} onClick={() => navigate(`/history/${e.session.id}`)} />
              ) : (
                <button key={e.log.id} className="list-row" onClick={() => setLogMenu(e.log)}>
                  <span className={`log-icon log-icon--${e.log.status}`}>
                    {e.log.status === 'skipped' ? <SkipForward size={16} /> : <Moon size={16} />}
                  </span>
                  <div className="list-row__main">
                    <div className="list-row__title">
                      {e.log.status === 'skipped'
                        ? `Skipped${e.log.routine_day_id && db.tables.routine_days[e.log.routine_day_id] ? ` · ${db.tables.routine_days[e.log.routine_day_id].name}` : ''}`
                        : 'Rest day'}
                    </div>
                    <div className="list-row__sub">
                      {[fmtDate(dateFromKey(e.log.log_date), { weekday: 'short', month: 'short', day: 'numeric' }), e.log.status === 'skipped' && e.log.skip_reason ? skipReasonLabel(e.log.skip_reason) : null, e.log.notes]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </button>
              ),
            )}
          </div>
        )}
      </section>

      <ActionSheet
        open={!!logMenu}
        onClose={() => setLogMenu(null)}
        title={logMenu?.status === 'skipped' ? 'Skipped workout' : 'Rest day'}
        actions={logMenu ? [{ label: 'Remove this entry', icon: <Trash2 size={20} />, danger: true, onClick: () => clearDayLog(logMenu.id) }] : []}
      />
    </div>
  );
}

function SessionRow({ session, onClick }: { session: WorkoutSession; onClick: () => void }) {
  const db = useDb();
  const idx = workoutIndex(db.tables);
  const sum = sessionSummary(idx, session.id);
  const ex = exercisesPerformed(idx, session.id);
  return (
    <button className="list-row" onClick={onClick}>
      <span className="log-icon log-icon--completed">
        <span className="num">{new Date(session.started_at).getDate()}</span>
      </span>
      <div className="list-row__main">
        <div className="list-row__title">{session.workout_name_snapshot}</div>
        <div className="list-row__sub">
          {fmtDate(session.started_at, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtDurationShort(session.duration_seconds)} · {ex} ex · {sum.setsCompleted} sets
        </div>
      </div>
      <ChevronRight size={16} className="faint" />
    </button>
  );
}
