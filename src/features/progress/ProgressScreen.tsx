import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Search, TrendingUp, Trophy } from 'lucide-react';
import { useDb } from '../../lib/db';
import { recentPRs, weekStreak, workoutIndex, workoutsThisWeek } from '../../lib/queries';
import { EmptyState, Stat } from '../../components/ui';
import { fmtSet } from '../../components/SetTable';
import { fmtDate, fmtDurationShort, fmtRelativeDay } from '../../utils/dates';
import { setStats } from '../../utils/calculations';

export default function ProgressScreen() {
  const db = useDb();
  const navigate = useNavigate();
  const idx = workoutIndex(db.tables);
  const [q, setQ] = useState('');
  const timed = idx.completed.filter((s) => s.duration_seconds != null);
  const totalSeconds = timed.reduce((a, s) => a + (s.duration_seconds ?? 0), 0);
  const prs = useMemo(() => recentPRs(db, idx, 5), [db, idx]);
  const streak = weekStreak(idx);

  const exercises = useMemo(() => {
    const out = [];
    for (const [exerciseId, entries] of idx.historyByExercise) {
      const ex = db.tables.exercises[exerciseId];
      if (!ex || ex.deleted_at) continue;
      const withSets = entries.filter((h) => h.sets.some((s) => s.completed));
      if (!withSets.length) continue;
      const last = withSets[0];
      out.push({ ex, last, count: withSets.length });
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return out
      .filter(({ ex }) => terms.every((t) => `${ex.name} ${ex.equipment ?? ''}`.toLowerCase().includes(t)))
      .sort((a, b) => b.last.session.started_at.localeCompare(a.last.session.started_at));
  }, [idx, db.tables.exercises, q]);

  if (idx.completed.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <div className="page-title">Progress</div>
        </header>
        <div className="card">
          <EmptyState icon={<TrendingUp size={24} />} title="No workouts yet">
            Finish your first workout to see records, estimated 1RM and charts here.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title">Progress</div>
      </header>

      <div className="stat-grid stagger">
        <Stat label="Workouts" value={idx.completed.length} sub="completed" />
        <Stat label="This week" value={workoutsThisWeek(idx)} sub={streak > 1 ? `${streak}-week streak` : 'workouts'} />
        <Stat label="Training time" value={timed.length ? fmtDurationShort(totalSeconds) : '–'} sub={timed.length < idx.completed.length ? 'logged in app' : 'total'} />
        <Stat label="Avg. workout" value={timed.length ? fmtDurationShort(totalSeconds / timed.length) : '–'} sub={timed.length ? 'duration' : 'not recorded yet'} />
      </div>

      {prs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <span className="section-title">Recent records</span>
          </div>
          <div className="list">
            {prs.map(({ exercise, point }) => {
              const unit = exercise.weight_unit ?? db.profile.weight_unit;
              const top = setStats(point.sets, exercise.exercise_type).topSet;
              return (
                <button key={`${exercise.id}-${point.session.id}`} className="list-row" onClick={() => navigate(`/progress/exercise/${exercise.id}`)}>
                  <Trophy size={18} className="accent" />
                  <div className="list-row__main">
                    <div className="list-row__title">{exercise.name}</div>
                    <div className="list-row__sub">{fmtDate(point.session.started_at, { month: 'short', day: 'numeric' })}</div>
                  </div>
                  <span className="num" style={{ fontWeight: 600 }}>
                    {top ? fmtSet(top, exercise.exercise_type, unit) : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <span className="section-title">Exercises</span>
        </div>
        <div className="search" style={{ marginBottom: 10 }}>
          <Search size={18} />
          <input className="input" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="list stagger">
          {exercises.map(({ ex, last, count }) => {
            const unit = ex.weight_unit ?? db.profile.weight_unit;
            const top = setStats(last.sets, ex.exercise_type).topSet;
            return (
              <button key={ex.id} className="list-row" onClick={() => navigate(`/progress/exercise/${ex.id}`)}>
                <div className="list-row__main">
                  <div className="list-row__title">{ex.name}</div>
                  <div className="list-row__sub">
                    {[ex.equipment, `${count} ${count === 1 ? 'session' : 'sessions'}`, fmtRelativeDay(last.session.started_at)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="list-row__trail num">
                  {top ? fmtSet(top, ex.exercise_type, unit) : ''}
                  <ChevronRight size={16} />
                </span>
              </button>
            );
          })}
          {exercises.length === 0 && <div className="list-row muted">No matches.</div>}
        </div>
      </section>
    </div>
  );
}
