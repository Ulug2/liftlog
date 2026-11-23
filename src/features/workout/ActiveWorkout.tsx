import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  History,
  Pause,
  Play,
  Plus,
  SkipForward,
  StickyNote,
  Trash2,
  Undo2,
  Bell,
  X,
} from 'lucide-react';
import { useDb, getState } from '../../lib/db';
import {
  bestsFor,
  liveElapsedSeconds,
  previousPerformance,
  setIsPR,
  workoutIndex,
  type WorkoutIndex,
} from '../../lib/queries';
import {
  addExerciseToWorkout,
  addSet,
  applyToRemaining,
  completeSet,
  discardWorkout,
  finishWorkout,
  pauseWorkout,
  removeSet,
  removeWorkoutExercise,
  resumeWorkout,
  setCurrentExercise,
  setExerciseNote,
  setExerciseSkipped,
  uncompleteSet,
  updateSet,
} from '../../lib/actions';
import { ActionSheet, EmptyState, Sheet, showToast, useNow } from '../../components/ui';
import { enableNotifications, useNotifyStatus } from '../../lib/notify';
import { ExercisePicker } from '../../components/ExercisePicker';
import { SetTable, fmtSet } from '../../components/SetTable';
import { RestTimer } from './RestTimer';
import { targetLabel } from '../routines/DayEditor';
import { fmtDate, fmtDuration, fmtRest } from '../../utils/dates';
import type { WeightUnit, WorkoutExercise, WorkoutSession } from '../../types/models';
import { getMeta, putMeta, setWorkoutUi } from '../../lib/db';
import { useWakeLock } from './useWakeLock';

export function ActiveWorkout() {
  const db = useDb();
  const navigate = useNavigate();
  const idx = workoutIndex(db.tables);
  const session = idx.active;
  const [menuOpen, setMenuOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [direction, setDirection] = useState<'from-right' | 'from-left' | 'from-none'>('from-none');
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow(1000, !!session && !session.paused_at);
  useWakeLock(!!session);

  // If the device lost its UI state (e.g. workout synced from elsewhere), rebuild it.
  useEffect(() => {
    if (session && db.workoutUi?.sessionId !== session.id) {
      setWorkoutUi({ sessionId: session.id, currentExerciseId: idx.weBySession.get(session.id)?.[0]?.id ?? null, rest: null });
    }
  }, [session, db.workoutUi, idx]);

  if (!session) {
    return (
      <div className="screen">
        <div className="screen__scroll">
        <div className="page page--no-nav">
        <EmptyState icon={<Check size={24} />} title="No workout in progress">
          <button className="btn btn--primary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
            Go home
          </button>
        </EmptyState>
        </div>
        </div>
      </div>
    );
  }

  const wes = idx.weBySession.get(session.id) ?? [];
  const ui = db.workoutUi?.sessionId === session.id ? db.workoutUi : null;
  const current = wes.find((w) => w.id === ui?.currentExerciseId) ?? wes[0] ?? null;
  const currentIndex = current ? wes.indexOf(current) : -1;

  const counted = wes.filter((w) => w.status !== 'skipped');
  let setsDone = 0;
  let setsTotal = 0;
  let exDone = 0;
  for (const w of counted) {
    const sets = idx.setsByWe.get(w.id) ?? [];
    const d = sets.filter((s) => s.completed).length;
    setsDone += d;
    setsTotal += sets.length;
    if (sets.length > 0 && d === sets.length) exDone++;
  }

  const jumpTo = (id: string) => {
    const target = wes.findIndex((w) => w.id === id);
    if (target === currentIndex) return;
    setDirection(target > currentIndex ? 'from-right' : 'from-left');
    setCurrentExercise(id);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const go = (delta: number) => {
    const next = wes[currentIndex + delta];
    if (next) jumpTo(next.id);
  };

  const doFinish = () => {
    finishWorkout(session.id);
    navigate(`/summary/${session.id}`, { replace: true });
  };

  const currentSets = current ? idx.setsByWe.get(current.id) ?? [] : [];
  const currentDone = currentSets.length > 0 && currentSets.every((s) => s.completed);
  const nextEx = wes[currentIndex + 1];

  return (
    <div className="screen workout screen--up">
      <header className="workout-head">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Minimize workout">
          <ChevronDown size={26} />
        </button>
        <div className="workout-head__center">
          <div className="workout-head__name">{session.workout_name_snapshot}</div>
          <div className={`workout-head__timer num${session.paused_at ? ' is-paused' : ''}`}>{fmtDuration(liveElapsedSeconds(session, now))}</div>
        </div>
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Workout menu">
          <Ellipsis size={22} />
        </button>
        <button className="btn btn--sm btn--primary" onClick={() => (setsTotal > setsDone || setsDone === 0 ? setFinishOpen(true) : doFinish())}>
          Finish
        </button>
      </header>

      <div className="screen__scroll" ref={scrollRef}>
      <div className="workout-progress">
        <div className="workout-progress__text">
          <span>
            Exercises <b className="num">{exDone}/{counted.length}</b>
          </span>
          <span>
            Sets <b className="num">{setsDone}/{setsTotal}</b>
          </span>
        </div>
        <div className="progress-bar">
          <div style={{ transform: `scaleX(${setsTotal ? setsDone / setsTotal : 0})` }} />
        </div>
      </div>

      {session.paused_at && (
        <button className="paused-banner" onClick={() => resumeWorkout(session.id)}>
          <Pause size={16} /> Workout paused — tap to resume
        </button>
      )}

      <NotifyPrompt />

      <ExerciseStrip wes={wes} idx={idx} currentId={current?.id} onPick={jumpTo} />

      <main className="workout-main">
        {current ? (
          <ExerciseLogger key={current.id} session={session} we={current} idx={idx} direction={direction} />
        ) : (
          <EmptyState icon={<Plus size={24} />} title="Empty workout">
            <p style={{ marginBottom: 16 }}>Add exercises as you go.</p>
          </EmptyState>
        )}
        <button className="btn btn--block btn--ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Plus size={18} /> Add exercise to this workout
        </button>
      </main>
      </div>

      <footer className="workout-foot">
        {ui?.rest && <RestTimer rest={ui.rest} />}
        <div className="workout-foot__nav">
          <button className="btn" disabled={currentIndex <= 0} onClick={() => go(-1)} aria-label="Previous exercise">
            <ChevronLeft size={20} />
          </button>
          {nextEx ? (
            <button className={`btn workout-foot__next${currentDone ? ' btn--primary' : ''}`} onClick={() => go(1)}>
              <span className="workout-foot__next-label">Next: {nextEx.exercise_name_snapshot}</span>
              <ChevronRight size={20} />
            </button>
          ) : (
            <button
              className={`btn workout-foot__next${currentDone ? ' btn--primary' : ''}`}
              onClick={() => (setsTotal > setsDone || setsDone === 0 ? setFinishOpen(true) : doFinish())}
            >
              Finish workout
            </button>
          )}
        </div>
      </footer>

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={session.workout_name_snapshot}
        actions={[
          session.paused_at
            ? { label: 'Resume workout', icon: <Play size={20} />, onClick: () => resumeWorkout(session.id) }
            : { label: 'Pause workout timer', icon: <Pause size={20} />, onClick: () => pauseWorkout(session.id) },
          { label: 'Add exercise', icon: <Plus size={20} />, onClick: () => setAdding(true) },
          { label: 'Finish workout', icon: <Check size={20} />, onClick: () => setFinishOpen(true) },
          { label: 'Discard workout', icon: <Trash2 size={20} />, danger: true, onClick: () => setFinishOpen(true) },
        ]}
      />

      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Finish workout?">
        <p className="muted" style={{ marginBottom: 16 }}>
          {setsDone === 0
            ? 'No sets are completed yet. Discard this workout, or keep going.'
            : setsTotal > setsDone
              ? `${setsTotal - setsDone} ${setsTotal - setsDone === 1 ? 'set is' : 'sets are'} not completed and won't be saved. Everything you checked off is kept.`
              : 'All sets completed.'}
        </p>
        <div className="stack">
          {setsDone > 0 && (
            <button className="btn btn--primary btn--lg btn--block" onClick={doFinish}>
              Finish and save
            </button>
          )}
          <button className="btn btn--block" onClick={() => setFinishOpen(false)}>
            Keep going
          </button>
          <button
            className="btn btn--danger btn--block"
            onClick={() => {
              discardWorkout(session.id);
              navigate('/', { replace: true });
            }}
          >
            Discard workout
          </button>
        </div>
      </Sheet>

      <ExercisePicker
        open={adding}
        onClose={() => setAdding(false)}
        title="Add to workout"
        excludeIds={wes.map((w) => w.exercise_id)}
        onPick={(id) => addExerciseToWorkout(session.id, id)}
      />
    </div>
  );
}

/* ----------------------------- Exercise strip ----------------------------- */

function ExerciseStrip({ wes, idx, currentId, onPick }: { wes: WorkoutExercise[]; idx: WorkoutIndex; currentId?: string; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [currentId]);
  if (wes.length < 2) return null;
  return (
    <div className="ex-strip" ref={ref}>
      {wes.map((w, i) => {
        const sets = idx.setsByWe.get(w.id) ?? [];
        const done = sets.filter((s) => s.completed).length;
        const complete = sets.length > 0 && done === sets.length;
        const cls = ['ex-chip', w.id === currentId && 'is-current', complete && 'is-complete', w.status === 'skipped' && 'is-skipped', done > 0 && !complete && 'is-partial']
          .filter(Boolean)
          .join(' ');
        return (
          <button key={w.id} className={cls} onClick={() => onPick(w.id)}>
            <span className="ex-chip__idx">{complete ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
            <span className="ex-chip__name">{w.exercise_name_snapshot}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------- Exercise logger ---------------------------- */

function ExerciseLogger({
  session,
  we,
  idx,
  direction,
}: {
  session: WorkoutSession;
  we: WorkoutExercise;
  idx: WorkoutIndex;
  direction: 'from-right' | 'from-left' | 'from-none';
}) {
  const db = useDb();
  const navigate = useNavigate();
  const exercise = db.tables.exercises[we.exercise_id];
  const unit: WeightUnit = exercise?.weight_unit ?? db.profile.weight_unit;
  const type = we.exercise_type_snapshot;
  const sets = idx.setsByWe.get(we.id) ?? [];
  const prev = previousPerformance(idx, we.exercise_id, session.id);
  const [menu, setMenu] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(we.notes ?? '');
  const [lastEdited, setLastEdited] = useState<string | null>(null);

  const prSetIds = useMemo(() => {
    const prior = bestsFor(idx, we.exercise_id, session.id);
    const hasHistory = (idx.historyByExercise.get(we.exercise_id) ?? []).some((h) => h.session.id !== session.id);
    return new Set(sets.filter((s) => setIsPR(s, type, prior, hasHistory)).map((s) => s.id));
  }, [idx, we.exercise_id, session.id, sets, type]);

  const lastEditedSet = sets.find((s) => s.id === lastEdited);
  const canApply = lastEditedSet && sets.some((s) => s.set_number > lastEditedSet.set_number && !s.completed);
  const skipped = we.status === 'skipped';
  const repPlaceholder = we.max_reps != null ? String(we.max_reps) : undefined;

  return (
    <section className={`logger ${direction}${skipped ? ' is-skipped' : ''}`}>
      <div className="logger__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="logger__name">{we.exercise_name_snapshot}</h1>
          <div className="logger__meta">
            {[we.equipment_snapshot, targetLabel(we), we.rest_seconds ? `Rest ${fmtRest(we.rest_seconds)}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button className="icon-btn icon-btn--filled" onClick={() => setMenu(true)} aria-label="Exercise options">
          <Ellipsis size={20} />
        </button>
      </div>

      {(we.routine_notes_snapshot || we.notes) && (
        <div className="logger__notes">
          <StickyNote size={14} />
          <span>{[we.routine_notes_snapshot, we.notes].filter(Boolean).join(' — ')}</span>
        </div>
      )}

      <button className="prev-perf" onClick={() => setHistoryOpen(true)}>
        <span className="prev-perf__label">{prev ? `Last time · ${fmtDate(prev.session.started_at, { month: 'short', day: 'numeric' })}` : 'Last time'}</span>
        <span className="prev-perf__value num">{prev ? summarizeSets(prev.sets, type, unit) : 'First time — no history yet'}</span>
      </button>

      {skipped ? (
        <div className="skipped-banner">
          <span>Skipped for this workout</span>
          <button className="btn btn--sm" onClick={() => setExerciseSkipped(we.id, false)}>
            <Undo2 size={16} /> Unskip
          </button>
        </div>
      ) : (
        <>
          <SetTable
            sets={sets}
            type={type}
            unit={unit}
            previous={prev?.sets}
            prSetIds={prSetIds}
            mode="live"
            repPlaceholder={repPlaceholder}
            onUpdate={(id, patch) => {
              updateSet(id, patch);
              setLastEdited(id);
            }}
            onToggle={(s) => (s.completed ? uncompleteSet(s.id) : completeSet(s.id))}
            onRemove={(s) => removeSet(s.id)}
            onApplyRemaining={(s) => applyToRemaining(s.id)}
          />
          <div className="logger__actions">
            <button className="btn btn--sm" onClick={() => addSet(we.id)}>
              <Plus size={16} /> Add set
            </button>
            {canApply && (
              <button
                className="btn btn--sm btn--ghost accent"
                onClick={() => {
                  applyToRemaining(lastEditedSet!.id);
                  setLastEdited(null);
                }}
              >
                Apply set {lastEditedSet!.set_number} to remaining
              </button>
            )}
          </div>
        </>
      )}

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={we.exercise_name_snapshot}
        actions={[
          { label: 'Exercise history', icon: <History size={20} />, onClick: () => setHistoryOpen(true) },
          { label: we.notes ? 'Edit note' : 'Add note', icon: <StickyNote size={20} />, onClick: () => setNoteOpen(true) },
          skipped
            ? { label: 'Unskip exercise', icon: <Undo2 size={20} />, onClick: () => setExerciseSkipped(we.id, false) }
            : { label: 'Skip exercise', icon: <SkipForward size={20} />, onClick: () => setExerciseSkipped(we.id, true) },
          {
            label: 'Remove from this workout',
            icon: <Trash2 size={20} />,
            danger: true,
            hidden: sets.some((s) => s.completed),
            onClick: () => {
              const wes = workoutIndex(getState().tables).weBySession.get(session.id) ?? [];
              const i = wes.findIndex((w) => w.id === we.id);
              const neighbor = wes[i + 1] ?? wes[i - 1];
              removeWorkoutExercise(we.id);
              if (neighbor) setCurrentExercise(neighbor.id);
            },
          },
        ]}
      />

      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Note" actions={<button className="btn btn--primary btn--lg" onClick={() => { setExerciseNote(we.id, note); setNoteOpen(false); }}>Save note</button>}>
        <textarea className="textarea" autoFocus rows={4} value={note} placeholder="Seat at 4, felt strong…" onChange={(e) => setNote(e.target.value)} />
      </Sheet>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={we.exercise_name_snapshot}>
        <ExerciseHistoryList exerciseId={we.exercise_id} excludeSessionId={session.id} unit={unit} />
        <button className="btn btn--block" style={{ marginTop: 12 }} onClick={() => navigate(`/progress/exercise/${we.exercise_id}`)}>
          Full progress
        </button>
      </Sheet>
    </section>
  );
}

export function summarizeSets(sets: { weight_kg: number | null; reps: number | null; duration_seconds: number | null; distance_m: number | null }[], type: WorkoutExercise['exercise_type_snapshot'], unit: WeightUnit) {
  if (!sets.length) return '–';
  if (type === 'weight' || type === 'weighted_bodyweight') {
    const sameWeight = sets.every((s) => s.weight_kg === sets[0].weight_kg);
    if (sameWeight && sets[0].weight_kg != null) {
      const w = fmtSet({ ...sets[0], reps: null }, type, unit).replace(' × –', '');
      return `${w} ${unit} · ${sets.map((s) => s.reps ?? '–').join(' / ')}`;
    }
    return sets.map((s) => fmtSet(s, type, unit)).join(', ');
  }
  return sets.map((s) => fmtSet(s, type, unit)).join(', ');
}

function ExerciseHistoryList({ exerciseId, excludeSessionId, unit }: { exerciseId: string; excludeSessionId?: string; unit: WeightUnit }) {
  const db = useDb();
  const idx = workoutIndex(db.tables);
  const entries = (idx.historyByExercise.get(exerciseId) ?? [])
    .filter((h) => h.session.id !== excludeSessionId)
    .map((h) => ({ ...h, sets: h.sets.filter((s) => s.completed) }))
    .filter((h) => h.sets.length)
    .slice(0, 8);
  if (!entries.length) return <p className="muted">No previous sessions yet.</p>;
  return (
    <div className="list">
      {entries.map((h) => (
        <div key={h.we.id} className="list-row" style={{ alignItems: 'flex-start' }}>
          <div className="list-row__main">
            <div className="list-row__title" style={{ fontWeight: 500 }}>{fmtDate(h.session.started_at, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div className="history-sets num">
              {h.sets.map((s) => (
                <span key={s.id}>{fmtSet(s, h.we.exercise_type_snapshot, unit)}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------- one-time notification prompt ------------------------- */

function NotifyPrompt() {
  const status = useNotifyStatus();
  const [hidden, setHidden] = useState(() => !!getMeta<boolean>('notifyPromptDismissed'));
  const [busy, setBusy] = useState(false);
  if (hidden || status !== 'off') return null;
  const dismiss = () => {
    putMeta('notifyPromptDismissed', true);
    setHidden(true);
  };
  return (
    <div className="notify-prompt">
      <Bell size={18} style={{ flex: 'none' }} />
      <span style={{ flex: 1 }}>Get an alert on your Lock Screen when rest is over.</span>
      <button
        className="btn btn--sm btn--primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await enableNotifications();
          setBusy(false);
          if (r.ok) dismiss();
          else if (r.message) showToast(r.message);
        }}
      >
        Turn on
      </button>
      <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
