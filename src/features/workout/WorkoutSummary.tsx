import { useNavigate, useParams } from 'react-router-dom';
import { Check, Trophy } from 'lucide-react';
import { useDb } from '../../lib/db';
import { bestsFor, exercisesPerformed, sessionSummary, setIsPR, workoutIndex } from '../../lib/queries';
import { Stat } from '../../components/ui';
import { fmtSet } from '../../components/SetTable';
import { fmtDate, fmtDuration } from '../../utils/dates';
import { fmtVolume } from '../../utils/units';

export function WorkoutSummary() {
  const { sessionId = '' } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const session = db.tables.workout_sessions[sessionId];
  const idx = workoutIndex(db.tables);
  if (!session) return null;
  const sum = sessionSummary(idx, session.id);
  const unit = db.profile.weight_unit;

  const prs: { name: string; text: string }[] = [];
  for (const we of idx.weBySession.get(session.id) ?? []) {
    const ex = db.tables.exercises[we.exercise_id];
    const exUnit = ex?.weight_unit ?? unit;
    const prior = bestsFor(idx, we.exercise_id, session.id);
    const hasHistory = (idx.historyByExercise.get(we.exercise_id) ?? []).some((h) => h.session.id !== session.id && h.session.started_at < session.started_at);
    const best = (idx.setsByWe.get(we.id) ?? []).filter((s) => setIsPR(s, we.exercise_type_snapshot, prior, hasHistory));
    if (best.length) prs.push({ name: we.exercise_name_snapshot, text: fmtSet(best[best.length - 1], we.exercise_type_snapshot, exUnit) });
  }

  return (
    <div className="screen">
      <div className="screen__scroll">
    <div className="page page--no-nav summary">
      <div className="summary__hero">
        <div className="summary__check">
          <Check size={30} strokeWidth={3} />
        </div>
        <div className="eyebrow">Workout completed</div>
        <h1 className="summary__title">{session.workout_name_snapshot}</h1>
        <div className="muted">{fmtDate(session.started_at, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>

      <div className="stat-grid">
        <Stat label="Duration" value={fmtDuration(session.duration_seconds)} />
        <Stat label="Exercises" value={exercisesPerformed(idx, session.id)} />
        <Stat label="Sets completed" value={sum.setsCompleted} />
        <Stat label="Volume" value={sum.volumeKg ? fmtVolume(sum.volumeKg, unit) : '–'} />
      </div>

      {prs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <span className="section-title">Personal records</span>
          </div>
          <div className="list">
            {prs.map((p) => (
              <div className="list-row" key={p.name}>
                <Trophy size={18} className="accent" />
                <div className="list-row__main">
                  <div className="list-row__title">{p.name}</div>
                </div>
                <span className="num accent" style={{ fontWeight: 600 }}>{p.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="stack" style={{ marginTop: 28 }}>
        <button className="btn btn--primary btn--lg btn--block" onClick={() => navigate('/', { replace: true })}>
          Done
        </button>
        <button className="btn btn--block" onClick={() => navigate(`/history/${session.id}`, { replace: true })}>
          Review workout
        </button>
      </div>
    </div>
      </div>
    </div>
  );
}
