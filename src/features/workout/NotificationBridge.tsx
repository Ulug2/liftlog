import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getState } from '../../lib/db';
import { workoutIndex } from '../../lib/queries';
import { cancelRestPush, clearLocal, getNotifyStatus, scheduleRestPush } from '../../lib/notify';
import { fmtSet } from '../../components/SetTable';

/** What's next after the rest: "Set 3 of 4 · Barbell Bench Press · 160 × 8" */
function nextSetLabel(): string {
  const s = getState();
  const ui = s.workoutUi;
  const idx = workoutIndex(s.tables);
  const session = idx.active;
  if (!ui?.rest || !session) return 'Time for your next set.';
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
  return 'All sets done — finish when you’re ready.';
}

/**
 * The only notification LiftLog sends: "Rest over", at the moment the rest timer ends.
 * When the app goes to the background with a rest running, the alert is scheduled on the
 * server (so it arrives even with the phone locked). Coming back cancels it — the in-app
 * timer takes over. Tapping the notification opens the workout.
 */
export function NotificationBridge() {
  const navigate = useNavigate();
  const scheduled = useRef(false);

  useEffect(() => {
    const onHidden = () => {
      if (getNotifyStatus() !== 'on') return;
      const s = getState();
      const rest = s.workoutUi?.rest;
      if (!workoutIndex(s.tables).active || !rest?.endsAt || !s.sync.userId) return;
      if (rest.endsAt <= Date.now() + 1500) return; // already (nearly) over
      scheduleRestPush(s.sync.userId, new Date(rest.endsAt), 'Rest over', nextSetLabel());
      scheduled.current = true;
    };

    const onVisible = () => {
      void clearLocal(['rest', 'workout', 'test']);
      // Back in the app: the in-app timer takes over. This also cancels anything left
      // over if the app was closed while an alert was pending.
      if (scheduled.current || getNotifyStatus() === 'on') cancelRestPush();
      scheduled.current = false;
    };

    const onVis = () => (document.visibilityState === 'hidden' ? onHidden() : onVisible());
    document.addEventListener('visibilitychange', onVis);
    if (document.visibilityState === 'visible') onVisible();
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Tapping the notification: the service worker asks the open app to show the workout.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-workout') {
        navigate(workoutIndex(getState().tables).active ? '/workout' : '/');
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}
