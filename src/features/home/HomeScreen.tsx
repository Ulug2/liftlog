import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Dumbbell, Moon, Play, Settings, Sparkles } from 'lucide-react';
import { useDb } from '../../lib/db';
import { syncConfigured } from '../../lib/supabase';
import {
  activeRoutine,
  dayExercises,
  plannedPerWeek,
  routineDays,
  scheduledDaysFor,
  weekDays,
  workoutIndex,
  workoutsThisWeek,
} from '../../lib/queries';
import { clearDayLog, logRestDay, skipReasonLabel } from '../../lib/actions';
import { fmtDate, fmtShortDay, greetSir, localDateKey, WEEKDAY_LETTER } from '../../utils/dates';
import { Sheet } from '../../components/ui';
import { useStartWorkout } from '../workout/useStartWorkout';
import { SkipSheet } from './SkipSheet';
import { SyncBadge } from '../settings/SyncBadge';
import type { RoutineDay } from '../../types/models';

export function HomeScreen() {
  const db = useDb();
  const navigate = useNavigate();
  const { start, sheet } = useStartWorkout();
  const [skipOpen, setSkipOpen] = useState(false);
  const [preview, setPreview] = useState<RoutineDay | null>(null);

  const idx = workoutIndex(db.tables);
  const routine = activeRoutine(db);
  const days = routineDays(db.tables, routine?.id);
  const today = new Date();
  const todayKey = localDateKey(today);
  const scheduled = scheduledDaysFor(db, today);
  const primary = scheduled[0] ?? null;
  const log = idx.logsByDate.get(todayKey);
  const doneToday = idx.sessionsByDate.get(todayKey) ?? [];
  const active = idx.active;
  const hasSchedule = days.some((d) => d.scheduled_weekdays.length > 0);

  const lastDone = (dayId: string) => idx.lastByDay.get(dayId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-title">{greetSir(today)}</div>
          <div className="page-subtitle">{fmtDate(today, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
        <div className="row" style={{ gap: 0 }}>
          <SyncBadge />
          <Link to="/settings" className="icon-btn" aria-label="Settings">
            <Settings size={22} />
          </Link>
        </div>
      </header>

      {/* ------------------------------ Today ------------------------------ */}
      {days.length === 0 ? (
        <div className="card today-card">
          <div className="eyebrow">Get started</div>
          <div className="today-card__title">Build your routine</div>
          <p className="muted">Create your training days and exercises — any split you like.</p>
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn btn--primary btn--lg btn--block" onClick={() => navigate('/routine')}>
              <Dumbbell size={20} /> Create routine
            </button>
            {!syncConfigured && (
              <button className="btn btn--ghost btn--block" onClick={() => navigate('/settings#sample')}>
                <Sparkles size={18} /> Explore with sample data
              </button>
            )}
          </div>
        </div>
      ) : active ? (
        <div className="card card--accent today-card">
          <div className="eyebrow accent">In progress</div>
          <div className="today-card__title">{active.workout_name_snapshot}</div>
          {active.focus_snapshot && <div className="today-card__focus">{active.focus_snapshot}</div>}
          <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 16 }} onClick={() => navigate('/workout')}>
            Resume workout
          </button>
        </div>
      ) : primary ? (
        <div className="card today-card">
          <div className="row">
            <div className="eyebrow">Today</div>
            <span className="spacer" />
            {doneToday.some((s) => s.routine_day_id === primary.id) && <span className="chip chip--accent">Completed</span>}
            {log?.status === 'skipped' && <span className="chip chip--warn">Skipped · {skipReasonLabel(log.skip_reason)}</span>}
          </div>
          <div className="today-card__title">{primary.name}</div>
          {primary.description && <div className="today-card__focus">{primary.description}</div>}
          <div className="today-card__meta">
            <span>{dayExercises(db.tables, primary.id).length} exercises</span>
            <span>
              {lastDone(primary.id) ? `Last completed: ${fmtDate(lastDone(primary.id)!.started_at)}` : 'Not completed yet'}
            </span>
          </div>
          <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 16 }} onClick={() => start(primary.id)}>
            <Play size={18} fill="currentColor" /> Start Workout
          </button>
          <div className="today-card__secondary">
            {log?.status === 'skipped' ? (
              <button className="text-btn text-btn--muted" onClick={() => clearDayLog(log.id)}>
                Undo skip
              </button>
            ) : (
              <button className="text-btn text-btn--muted" onClick={() => setSkipOpen(true)}>
                Skip today
              </button>
            )}
            {scheduled.length > 1 && (
              <span className="faint" style={{ fontSize: 13 }}>
                Also today: {scheduled.slice(1).map((d) => d.name).join(', ')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="card today-card">
          <div className="row">
            <div className="eyebrow">Today</div>
            <span className="spacer" />
            {log?.status === 'rest' && <span className="chip">Rest day logged</span>}
          </div>
          <div className="today-card__title">{hasSchedule ? 'Rest day' : 'No workout scheduled'}</div>
          <p className="muted" style={{ marginTop: 4 }}>
            {hasSchedule ? 'Nothing planned today. Train anyway by picking a workout below.' : 'Pick any workout below. Set weekdays in Routine to see today’s plan here.'}
          </p>
          <div className="today-card__secondary" style={{ marginTop: 12 }}>
            {log?.status === 'rest' ? (
              <button className="text-btn text-btn--muted" onClick={() => clearDayLog(log.id)}>
                Undo rest day
              </button>
            ) : (
              <button className="btn btn--sm" onClick={() => logRestDay(todayKey)}>
                <Moon size={16} /> Log rest day
              </button>
            )}
            <button className="btn btn--sm btn--ghost" onClick={() => start(null)}>
              Empty workout
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------ This week ------------------------------ */}
      {days.length > 0 && (
        <section className="section">
          <div className="card week-card">
            <div className="row">
              <div>
                <div className="eyebrow">This week</div>
                <div className="week-card__count num">
                  {workoutsThisWeek(idx)}
                  {plannedPerWeek(db) > 0 && <span className="muted"> / {plannedPerWeek(db)}</span>}
                  <span className="week-card__label"> workouts</span>
                </div>
              </div>
              <span className="spacer" />
              <div className="faint" style={{ fontSize: 13, textAlign: 'right' }}>
                {idx.completed.length} total
              </div>
            </div>
            <div className="week-dots">
              {weekDays(idx).map((d) => (
                <div key={d.key} className={`week-dot week-dot--${d.status}${d.key === todayKey ? ' is-today' : ''}`}>
                  <span className="week-dot__mark" />
                  <span className="week-dot__label">{WEEKDAY_LETTER[d.date.getDay()]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------ All workouts ------------------------------ */}
      {days.length > 0 && (
        <section className="section">
          <div className="section-head">
            <span className="section-title">Start any workout</span>
            <Link to="/routine" className="text-btn" style={{ minHeight: 0, fontSize: 14 }}>
              Edit
            </Link>
          </div>
          <div className="list stagger">
            {days.map((d) => {
              const last = lastDone(d.id);
              return (
                <button key={d.id} className="list-row" onClick={() => setPreview(d)}>
                  <div className="list-row__main">
                    <div className="list-row__title">{d.name}</div>
                    <div className="list-row__sub">
                      {`${dayExercises(db.tables, d.id).length} exercises`}{d.description ? ` · ${d.description}` : ''}
                    </div>
                  </div>
                  <span className="list-row__trail">
                    {last ? fmtShortDay(last.started_at) : 'New'}
                    <ChevronRight size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <SkipSheet open={skipOpen} onClose={() => setSkipOpen(false)} dateKey={todayKey} day={primary} />

      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name}
        actions={
          <button
            className="btn btn--primary btn--lg"
            onClick={() => {
              const id = preview!.id;
              setPreview(null);
              start(id);
            }}
          >
            <Play size={18} fill="currentColor" /> Start Workout
          </button>
        }
      >
        {preview && (
          <>
            {preview.description && <p className="muted" style={{ marginBottom: 12 }}>{preview.description}</p>}
            <div className="list">
              {dayExercises(db.tables, preview.id).map(({ re, exercise }) => (
                <div key={re.id} className="list-row" style={{ minHeight: 48 }}>
                  <div className="list-row__main">
                    <div className="list-row__title" style={{ fontWeight: 500 }}>{exercise.name}</div>
                    {exercise.equipment && <div className="list-row__sub">{exercise.equipment}</div>}
                  </div>
                  <span className="list-row__trail num">
                    {re.target_sets} × {re.min_reps != null ? (re.max_reps && re.max_reps !== re.min_reps ? `${re.min_reps}–${re.max_reps}` : re.min_reps) : re.target_seconds ? `${re.target_seconds}s` : '—'}
                  </span>
                </div>
              ))}
              {dayExercises(db.tables, preview.id).length === 0 && (
                <div className="list-row muted">No exercises yet — you can add them during the workout.</div>
              )}
            </div>
          </>
        )}
      </Sheet>
      {sheet}
    </div>
  );
}
