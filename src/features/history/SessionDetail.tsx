import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useDb } from '../../lib/db';
import { sessionSummary, workoutIndex } from '../../lib/queries';
import { addHistoricalSet, deleteSession, removeSet, setExerciseNote, updateSession, updateSet } from '../../lib/actions';
import { EmptyState, Field, Sheet, Stat, showToast } from '../../components/ui';
import { SetTable, fmtSet } from '../../components/SetTable';
import { fmtDate, fmtDuration } from '../../utils/dates';
import { fmtVolume } from '../../utils/units';
import { NumberField } from '../../components/NumberField';
import { nowIso, update } from '../../lib/db';

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function SessionDetail() {
  const { sessionId = '' } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const session = db.tables.workout_sessions[sessionId];
  const idx = workoutIndex(db.tables);

  if (!session || session.deleted_at) {
    return (
      <div className="page">
        <EmptyState icon={<Trash2 size={22} />} title="Workout not found">
          <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/history')}>
            Back to history
          </button>
        </EmptyState>
      </div>
    );
  }

  const wes = idx.weBySession.get(session.id) ?? [];
  const sum = sessionSummary(idx, session.id);
  const unitFor = (exerciseId: string) => db.tables.exercises[exerciseId]?.weight_unit ?? db.profile.weight_unit;

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" style={{ marginLeft: -12 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-title" style={{ fontSize: 20 }}>{session.workout_name_snapshot}</div>
          <div className="page-subtitle">
            {fmtDate(session.started_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} ·{' '}
            {new Date(session.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
        <button className="text-btn" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </header>

      {editing ? (
        <div className="card stack" style={{ gap: 14 }}>
          <Field label="Workout name">
            <input className="input" value={session.workout_name_snapshot} onChange={(e) => updateSession(session.id, { workout_name_snapshot: e.target.value })} />
          </Field>
          <div className="field-grid">
            <Field label="Started">
              <input
                className="input"
                type="datetime-local"
                value={toLocalInput(session.started_at)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const started = new Date(e.target.value).toISOString();
                  const finished = session.duration_seconds != null ? new Date(Date.parse(started) + session.duration_seconds * 1000).toISOString() : session.finished_at;
                  updateSession(session.id, { started_at: started, finished_at: finished });
                }}
              />
            </Field>
            <Field label="Duration (min)">
              <NumberField
                className="input"
                label="Duration in minutes"
                value={session.duration_seconds != null ? Math.round(session.duration_seconds / 60) : null}
                onChange={(v) => updateSession(session.id, { duration_seconds: v == null ? null : Math.round(v * 60) })}
              />
            </Field>
          </div>
          <Field label="Workout notes">
            <textarea className="textarea" rows={2} value={session.notes ?? ''} onChange={(e) => updateSession(session.id, { notes: e.target.value || null })} />
          </Field>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Duration" value={fmtDuration(session.duration_seconds)} />
            <Stat label="Sets" value={sum.setsCompleted} sub={`${sum.exercisesCompleted} of ${wes.length} exercises complete`} />
            {sum.volumeKg > 0 && <Stat label="Volume" value={fmtVolume(sum.volumeKg, db.profile.weight_unit)} />}
          </div>
          {session.notes && <p className="muted" style={{ marginTop: 12 }}>{session.notes}</p>}
        </>
      )}

      <div className="stack" style={{ marginTop: 16, gap: 10 }}>
        {wes.map((we) => {
          const sets = idx.setsByWe.get(we.id) ?? [];
          const unit = unitFor(we.exercise_id);
          return (
            <div key={we.id} className="card">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button className="session-ex__name" onClick={() => navigate(`/progress/exercise/${we.exercise_id}`)}>
                    {we.exercise_name_snapshot}
                  </button>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[we.equipment_snapshot, `Target ${we.target_sets}${we.min_reps != null ? ` × ${we.min_reps}${we.max_reps && we.max_reps !== we.min_reps ? `–${we.max_reps}` : ''}` : ''}`, we.status === 'skipped' ? 'Skipped' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
              {editing ? (
                <>
                  <SetTable
                    sets={sets}
                    type={we.exercise_type_snapshot}
                    unit={unit}
                    mode="edit"
                    onUpdate={(id, patch) => updateSet(id, patch)}
                    onToggle={(s) => update('workout_sets', s.id, { completed: !s.completed, completed_at: s.completed ? null : s.completed_at ?? nowIso() })}
                    onRemove={(s) => removeSet(s.id, true)}
                  />
                  <div className="logger__actions">
                    <button className="btn btn--sm" onClick={() => addHistoricalSet(we.id)}>
                      <Plus size={16} /> Add set
                    </button>
                  </div>
                  <textarea
                    className="textarea"
                    style={{ marginTop: 10, minHeight: 60 }}
                    rows={2}
                    placeholder="Exercise note"
                    defaultValue={we.notes ?? ''}
                    onBlur={(e) => setExerciseNote(we.id, e.target.value)}
                  />
                </>
              ) : sets.length ? (
                <div className="ro-sets">
                  {sets.map((s) => (
                    <div key={s.id} className={`ro-set${s.completed ? '' : ' is-incomplete'}`}>
                      <span className="ro-set__n num">{s.set_number}</span>
                      <span className="num">{fmtSet(s, we.exercise_type_snapshot, unit)}</span>
                      {(we.exercise_type_snapshot === 'weight' || we.exercise_type_snapshot === 'weighted_bodyweight') && s.weight_kg != null && (
                        <span className="faint" style={{ fontSize: 13 }}>{unit}</span>
                      )}
                      {!s.completed && <span className="chip">not completed</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="faint" style={{ marginTop: 8, fontSize: 14 }}>No sets recorded</p>
              )}
              {!editing && we.notes && (
                <div className="logger__notes" style={{ marginTop: 10 }}>
                  <StickyNote size={14} />
                  <span>{we.notes}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <button className="btn btn--danger btn--block" style={{ marginTop: 20 }} onClick={() => setConfirmDelete(true)}>
          <Trash2 size={18} /> Delete workout
        </button>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this workout?">
        <p className="muted" style={{ marginBottom: 16 }}>It will be removed from history and progress. Other workouts are not affected.</p>
        <div className="stack">
          <button
            className="btn btn--danger btn--lg btn--block"
            onClick={() => {
              deleteSession(session.id);
              navigate('/history', { replace: true });
              showToast('Workout deleted', { label: 'Undo', onClick: () => update('workout_sessions', session.id, { deleted_at: null }) });
            }}
          >
            Delete
          </button>
          <button className="btn btn--block" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}
