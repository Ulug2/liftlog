import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getState } from '../../lib/db';
import { discardWorkout, startWorkout } from '../../lib/actions';
import { workoutIndex } from '../../lib/queries';
import { Sheet } from '../../components/ui';

/** Start a workout — or, if one is already running, offer to resume it instead. */
export function useStartWorkout() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null | undefined>(undefined);

  const start = (dayId: string | null) => {
    if (workoutIndex(getState().tables).active) {
      setPending(dayId);
      return;
    }
    startWorkout(dayId);
    navigate('/workout');
  };

  const active = workoutIndex(getState().tables).active;
  const sheet = (
    <Sheet open={pending !== undefined} onClose={() => setPending(undefined)} title="Workout in progress">
      <p className="muted" style={{ marginBottom: 16 }}>
        {active?.workout_name_snapshot} is still running. Resume it, or discard it and start a new one.
      </p>
      <div className="stack">
        <button
          className="btn btn--primary btn--lg btn--block"
          onClick={() => {
            setPending(undefined);
            navigate('/workout');
          }}
        >
          Resume {active?.workout_name_snapshot}
        </button>
        <button
          className="btn btn--danger btn--block"
          onClick={() => {
            if (active) discardWorkout(active.id);
            const id = pending ?? null;
            setPending(undefined);
            startWorkout(id);
            navigate('/workout');
          }}
        >
          Discard it and start new
        </button>
      </div>
    </Sheet>
  );

  return { start, sheet };
}
