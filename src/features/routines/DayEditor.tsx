import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Copy, Ellipsis, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useDb } from '../../lib/db';
import { dayExercises, type DayExercise } from '../../lib/queries';
import {
  addExerciseToDay,
  duplicateRoutineExercise,
  removeRoutineExercise,
  reorder,
  updateDay,
  updateExercise,
  updateRoutineExercise,
} from '../../lib/actions';
import { ActionSheet, EmptyState, Field, Sheet, Stepper, WeekdayPicker, showToast } from '../../components/ui';
import { SortableList } from '../../components/SortableList';
import { ExercisePicker } from '../../components/ExercisePicker';
import { ExerciseForm } from '../../components/ExerciseForm';
import { fmtRest } from '../../utils/dates';
import { insert } from '../../lib/db';

export function targetLabel(re: { target_sets: number; min_reps: number | null; max_reps: number | null; target_seconds: number | null }) {
  const sets = `${re.target_sets} ${re.target_sets === 1 ? 'set' : 'sets'}`;
  if (re.target_seconds) return `${sets} · ${re.target_seconds}s`;
  if (re.min_reps == null && re.max_reps == null) return sets;
  const lo = re.min_reps ?? re.max_reps;
  const hi = re.max_reps ?? re.min_reps;
  return `${sets} · ${lo === hi ? lo : `${lo}–${hi}`} reps`;
}

export function DayEditor() {
  const { dayId = '' } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const day = db.tables.routine_days[dayId];
  const items = day ? dayExercises(db.tables, dayId) : [];
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<DayExercise | null>(null);
  const [editTargets, setEditTargets] = useState<string | null>(null);
  const [editDetails, setEditDetails] = useState<string | null>(null);

  if (!day || day.deleted_at) {
    return (
      <div className="page">
        <EmptyState icon={<Pencil size={22} />} title="Day not found" />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" style={{ marginLeft: -12 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <div className="page-title" style={{ flex: 1, fontSize: 18 }}>
          Edit day
        </div>
      </header>

      <div className="stack" style={{ gap: 14 }}>
        <Field label="Name">
          <input className="input" value={day.name} onChange={(e) => updateDay(day.id, { name: e.target.value })} onBlur={(e) => !e.target.value.trim() && updateDay(day.id, { name: 'Untitled day' })} />
        </Field>
        <Field label="Focus">
          <input
            className="input"
            value={day.description ?? ''}
            placeholder="Chest · Shoulders · Triceps"
            onChange={(e) => updateDay(day.id, { description: e.target.value || null })}
          />
        </Field>
        <div className="field">
          <span className="field__label">Scheduled on</span>
          <WeekdayPicker value={day.scheduled_weekdays} onChange={(v) => updateDay(day.id, { scheduled_weekdays: v })} />
          <span className="faint" style={{ fontSize: 13 }}>
            Shows up on Home on these days. You can always start it on any other day.
          </span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="section-title">Exercises ({items.length})</span>
        </div>
        {items.length === 0 ? (
          <div className="card muted" style={{ textAlign: 'center' }}>
            No exercises yet.
          </div>
        ) : (
          <SortableList
            items={items.map((x) => ({ ...x, id: x.re.id }))}
            onReorder={(next) => reorder('routine_exercises', next.map((x) => x.re))}
            renderItem={(item, handle) => (
              <div className="card ex-row">
                {handle}
                <button className="ex-row__main" onClick={() => setEditTargets(item.re.id)}>
                  <div className="ex-row__name">{item.exercise.name}</div>
                  <div className="ex-row__meta">
                    {[item.exercise.equipment, targetLabel(item.re), `Rest ${fmtRest(item.re.rest_seconds)}`].filter(Boolean).join(' · ')}
                  </div>
                  {item.exercise.archived_at && <span className="chip" style={{ marginTop: 4 }}>Archived exercise</span>}
                </button>
                <button className="icon-btn" aria-label="More" onClick={() => setMenu(item)}>
                  <Ellipsis size={20} />
                </button>
              </div>
            )}
          />
        )}
        <button className="btn btn--primary btn--block btn--lg" style={{ marginTop: 12 }} onClick={() => setPicker(true)}>
          <Plus size={20} /> Add exercise
        </button>
      </section>

      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        excludeIds={items.map((i) => i.exercise.id)}
        onPick={(exerciseId) => {
          const re = addExerciseToDay(day.id, exerciseId);
          setEditTargets(re.id);
        }}
      />

      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.exercise.name}
        actions={
          menu
            ? [
                { label: 'Sets, reps & rest', icon: <SlidersHorizontal size={20} />, onClick: () => setEditTargets(menu.re.id) },
                { label: 'Exercise details', icon: <Pencil size={20} />, onClick: () => setEditDetails(menu.exercise.id) },
                { label: 'Duplicate', icon: <Copy size={20} />, onClick: () => duplicateRoutineExercise(menu.re.id) },
                {
                  label: 'Remove from day',
                  icon: <Trash2 size={20} />,
                  danger: true,
                  onClick: () => {
                    const re = menu.re;
                    removeRoutineExercise(re.id);
                    showToast(`${menu.exercise.name} removed`, {
                      label: 'Undo',
                      onClick: () => {
                        const { id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = re;
                        insert('routine_exercises', rest);
                      },
                    });
                  },
                },
              ]
            : []
        }
      />

      <TargetsSheet reId={editTargets} onClose={() => setEditTargets(null)} onEditDetails={(id) => setEditDetails(id)} />

      <Sheet open={!!editDetails} onClose={() => setEditDetails(null)} title="Exercise details">
        {editDetails && db.tables.exercises[editDetails] && (
          <ExerciseForm
            key={editDetails}
            initial={db.tables.exercises[editDetails]}
            onSubmit={(d) => {
              updateExercise(editDetails, d);
              setEditDetails(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function TargetsSheet({ reId, onClose, onEditDetails }: { reId: string | null; onClose: () => void; onEditDetails: (exerciseId: string) => void }) {
  const db = useDb();
  const re = reId ? db.tables.routine_exercises[reId] : null;
  const ex = re ? db.tables.exercises[re.exercise_id] : null;
  const set = (patch: Parameters<typeof updateRoutineExercise>[1]) => re && updateRoutineExercise(re.id, patch);
  const isTime = ex?.exercise_type === 'time';
  const isDistance = ex?.exercise_type === 'distance';

  return (
    <Sheet open={!!re} onClose={onClose} title={ex?.name} actions={<button className="btn btn--primary btn--lg" onClick={onClose}>Done</button>}>
      {re && ex && (
        <div className="stack" style={{ gap: 14 }}>
          <Field label="Sets">
            <Stepper label="sets" value={re.target_sets} min={1} max={20} onChange={(v) => set({ target_sets: v })} />
          </Field>
          {isTime ? (
            <Field label="Target time">
              <Stepper label="seconds" value={re.target_seconds ?? 60} step={5} min={5} max={1800} format={(v) => fmtRest(v)} onChange={(v) => set({ target_seconds: v })} />
            </Field>
          ) : !isDistance ? (
            <div className="field-grid">
              <Field label="Min reps">
                <Stepper
                  label="min reps"
                  value={re.min_reps ?? 8}
                  min={1}
                  max={100}
                  onChange={(v) => set({ min_reps: v, max_reps: Math.max(v, re.max_reps ?? v) })}
                />
              </Field>
              <Field label="Max reps">
                <Stepper
                  label="max reps"
                  value={re.max_reps ?? 12}
                  min={1}
                  max={100}
                  onChange={(v) => set({ max_reps: v, min_reps: Math.min(v, re.min_reps ?? v) })}
                />
              </Field>
            </div>
          ) : null}
          <Field label="Rest between sets">
            <Stepper label="rest" value={re.rest_seconds} step={15} min={0} max={900} format={(v) => (v === 0 ? 'Off' : fmtRest(v))} onChange={(v) => set({ rest_seconds: v })} />
          </Field>
          <Field label="Notes for this day">
            <textarea className="textarea" rows={2} value={re.notes ?? ''} placeholder="Keep shoulder blades retracted" onChange={(e) => set({ notes: e.target.value || null })} />
          </Field>
          <button className="btn btn--ghost btn--block" onClick={() => onEditDetails(ex.id)}>
            <Pencil size={16} /> Edit exercise details
          </button>
          <p className="faint" style={{ fontSize: 13 }}>
            Changes apply to future workouts only. Past sessions keep what you actually did.
          </p>
        </div>
      )}
    </Sheet>
  );
}
