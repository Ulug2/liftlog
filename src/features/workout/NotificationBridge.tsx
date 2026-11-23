import { useEffect, useRef } from 'react';
import { getState } from '../../lib/db';
import { workoutIndex } from '../../lib/queries';
import { cancelRestPush, clearLocal, getNotifyStatus, scheduleRestPush, showLocal } from '../../lib/notify';
import { fmtSet } from '../../components/SetTable';
import { fmtClock } from '../../utils/dates';

const TAGS = ['workout', 'rest', 'test'];

const clock = (d: Date, seconds = false) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

/** What's next after the rest: "Set 3 of 4 · Barbell Bench Press · 160 × 8" */
function nextSetLabel(): string | null {
  const s = getState();
  const ui = s.workoutUi;
  const idx = workoutIndex(s.tables);
  const session = idx.active;
  if (!ui?.rest || !session) return null;
  const wes = (idx.weBySession.get(session.id) ?? []).filter((w) => w.status !== 'skipped');
  const start = Math.max(0, wes.findIndex((w) => w.id === ui.rest!.workoutExerciseId));
  for (const we of wes.slice(start)) {
    const sets = idx.setsByWe.get(we.id) ?? [];
    const next = sets.find((x) => !x.completed);
    if (next) {
      const unit = s.tables.exercises[we.exercise_id]?.weight_unit ?? s.profile.weight_unit;
      const target = next.weight_kg != null || next.reps != null ? ` · ${fmtSet(next, we.exercise_type_snapshot, unit)}` : '';
      return `Set ${next.set_number} of ${sets.length} · ${we.exercise_name_snapshot}${target}`;
    }
  }
  return 'All sets done — finish when you’re ready';
}

/**
 * Posts Lock Screen notifications when LiftLog goes to the background during a
 * workout, and clears them as soon as it comes back.
 */
export function NotificationBridge() {
  const scheduled = useRef(false);

  useEffect(() => {
    const onHidden = () => {
      if (getNotifyStatus() !== 'on') return;
      const s = getState();
      const session = workoutIndex(s.tables).active;
      if (!session) return;

      const started = new Date(session.started_at);
      void showLocal(
        'workout',
        `${session.workout_name_snapshot} in progress`,
        session.paused_at ? `Paused · started ${clock(started)}` : `Started ${clock(started)} · tap to return`,
      );

      const rest = s.workoutUi?.rest;
      const next = nextSetLabel() ?? '';
      if (rest?.endsAt && rest.endsAt > Date.now() + 1500) {
        const at = new Date(rest.endsAt);
        void showLocal('rest', `Resting · next set at ${clock(at, true)}`, next);
        if (s.sync.userId) {
          scheduleRestPush(s.sync.userId, at, 'Rest over — time for your next set', next);
          scheduled.current = true;
        }
      } else if (rest && rest.endsAt == null && rest.pausedRemaining != null) {
        void showLocal('rest', `Rest paused · ${fmtClock(rest.pausedRemaining)} left`, next);
      }
    };

    const onVisible = () => {
      void clearLocal(TAGS);
      // Back in the app: the in-app timer takes over. Also cancels anything left
      // over if the app was closed while a rest push was pending.
      if (scheduled.current || getNotifyStatus() === 'on') cancelRestPush();
      scheduled.current = false;
    };

    const onVis = () => (document.visibilityState === 'hidden' ? onHidden() : onVisible());
    document.addEventListener('visibilitychange', onVis);
    if (document.visibilityState === 'visible') onVisible();
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return null;
}
