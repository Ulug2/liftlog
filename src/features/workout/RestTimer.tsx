import { useEffect, useRef } from 'react';
import { Pause, Play, X } from 'lucide-react';
import type { RestState } from '../../types/models';
import { adjustRest, pauseRest, resumeRest, stopRest } from '../../lib/actions';
import { fmtClock } from '../../utils/dates';
import { useNow } from '../../components/ui';
import { chime } from '../../utils/audio';

/**
 * Compact rest timer. Remaining time is always endsAt − now, so it stays correct
 * after locking the phone or switching apps (iOS pauses JS timers in the background).
 */
export function RestTimer({ rest }: { rest: RestState }) {
  const running = rest.endsAt != null;
  const now = useNow(250, running);
  const remaining = running ? rest.endsAt! - now : rest.pausedRemaining ?? 0;
  const done = remaining <= 0;
  const pct = Math.max(0, Math.min(1, 1 - remaining / Math.max(1, rest.durationMs)));
  const notified = useRef(false);

  useEffect(() => {
    if (done && running && !notified.current) {
      notified.current = true;
      navigator.vibrate?.([120, 60, 120]);
      if (document.visibilityState === 'visible') chime();
    }
    if (!done) notified.current = false;
  }, [done, running]);

  return (
    <div className={`rest-timer${done ? ' is-done' : ''}`} role="timer" aria-live="polite">
      <div className="rest-timer__bar" style={{ transform: `scaleX(${pct})` }} />
      <div className="rest-timer__label">
        <span className="rest-timer__caption">{done ? 'Rest complete' : running ? 'Rest' : 'Rest paused'}</span>
        <span className="rest-timer__time num">{done ? fmtClock(0) : fmtClock(remaining)}</span>
      </div>
      {!done && (
        <>
          <button className="rest-btn" onClick={() => adjustRest(-15)} aria-label="Subtract 15 seconds">
            −15
          </button>
          <button className="rest-btn" onClick={() => adjustRest(15)} aria-label="Add 15 seconds">
            +15
          </button>
          <button className="rest-btn rest-btn--icon" onClick={() => (running ? pauseRest() : resumeRest())} aria-label={running ? 'Pause rest' : 'Resume rest'}>
            {running ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </>
      )}
      <button className="rest-btn rest-btn--icon" onClick={stopRest} aria-label={done ? 'Dismiss' : 'Skip rest'}>
        {done ? 'OK' : <X size={18} />}
      </button>
    </div>
  );
}
