import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { useDb } from '../../lib/db';
import { exerciseProgress, workoutIndex, type ProgressPoint } from '../../lib/queries';
import { EmptyState, Segmented, Sheet, Stat } from '../../components/ui';
import { LineChart, type ChartPoint } from '../../components/LineChart';
import { fmtSet } from '../../components/SetTable';
import { fmtDate } from '../../utils/dates';
import { fmtNum, fmtVolume, fmtWeight, toDisplay } from '../../utils/units';
import { supportsE1RM, usesWeight } from '../../utils/calculations';
import type { ExerciseType } from '../../types/models';
import { typeLabel } from '../../components/ExerciseForm';

type Metric = 'weight' | 'e1rm' | 'reps' | 'volume' | 'time' | 'distance';

function metricsFor(t: ExerciseType): { value: Metric; label: string }[] {
  switch (t) {
    case 'weight':
      return [
        { value: 'weight', label: 'Weight' },
        { value: 'e1rm', label: 'Est. 1RM' },
        { value: 'reps', label: 'Reps' },
        { value: 'volume', label: 'Volume' },
      ];
    case 'weighted_bodyweight':
      return [
        { value: 'weight', label: 'Added' },
        { value: 'reps', label: 'Reps' },
        { value: 'volume', label: 'Volume' },
      ];
    case 'bodyweight':
      return [
        { value: 'reps', label: 'Best set' },
        { value: 'volume', label: 'Total reps' },
      ];
    case 'time':
      return [{ value: 'time', label: 'Time' }];
    case 'distance':
      return [{ value: 'distance', label: 'Distance' }];
  }
}

export default function ExerciseProgressScreen() {
  const { exerciseId = '' } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const exercise = db.tables.exercises[exerciseId];
  const idx = workoutIndex(db.tables);
  const type = exercise?.exercise_type ?? 'weight';
  const prog = useMemo(() => exerciseProgress(idx, exerciseId, type), [idx, exerciseId, type]);
  const metrics = metricsFor(type);
  const [metric, setMetric] = useState<Metric>(metrics[0].value);
  const [open, setOpen] = useState<ProgressPoint | null>(null);
  const unit = exercise?.weight_unit ?? db.profile.weight_unit;

  const chart: ChartPoint[] = useMemo(
    () =>
      prog.points
        .map((p): ChartPoint | null => {
          const s = p.stats;
          const y =
            metric === 'weight' ? toDisplay(s.maxWeight, unit)
            : metric === 'e1rm' ? toDisplay(s.bestE1RM, unit)
            : metric === 'reps' ? s.maxReps
            : metric === 'volume' ? (usesWeight(type) ? toDisplay(s.volume, unit) : s.volume)
            : metric === 'time' ? s.totalSeconds && Math.max(...p.sets.map((x) => x.duration_seconds ?? 0))
            : s.totalDistance;
          return y == null ? null : { x: Date.parse(p.session.started_at), y, highlight: p.isPR };
        })
        .filter((p): p is ChartPoint => p != null),
    [prog, metric, unit, type],
  );

  if (!exercise) {
    return (
      <div className="page">
        <EmptyState icon={<Trophy size={22} />} title="Exercise not found" />
      </div>
    );
  }

  const formatY = (y: number) =>
    metric === 'weight' ? fmtNum(y, 1) : metric === 'e1rm' ? fmtNum(y, 0)
    : metric === 'volume' && usesWeight(type) ? (y >= 10000 ? `${fmtNum(y / 1000, 1)}k` : fmtNum(y, 0))
    : metric === 'time' ? `${fmtNum(y, 0)}s`
    : metric === 'distance' ? `${fmtNum(y, 0)}m`
    : fmtNum(y, 0);

  const yUnit = metric === 'weight' || metric === 'e1rm' || (metric === 'volume' && usesWeight(type)) ? unit : metric === 'reps' || metric === 'volume' ? 'reps' : '';

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" style={{ marginLeft: -12 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-title" style={{ fontSize: 20 }}>{exercise.name}</div>
          <div className="page-subtitle">{[exercise.equipment, typeLabel(exercise.exercise_type)].filter(Boolean).join(' · ')}</div>
        </div>
      </header>

      {prog.points.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Trophy size={22} />} title="No completed sets yet">
            Progress appears after you complete this exercise in a workout.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Best set" value={prog.bestSet ? fmtSet(prog.bestSet, type, unit) : '–'} sub={usesWeight(type) ? unit : undefined} />
            {usesWeight(type) ? (
              <Stat label={type === 'weighted_bodyweight' ? 'Most added' : 'Heaviest'} value={fmtWeight(prog.bests.maxWeight, unit)} />
            ) : (
              <Stat label="Most reps" value={prog.bests.maxReps ?? '–'} sub="in one set" />
            )}
            {supportsE1RM(type) && <Stat label="Est. 1RM" value={prog.bests.bestE1RM != null ? `${fmtNum(toDisplay(prog.bests.bestE1RM, unit), 0)} ${unit}` : '–'} sub="Epley estimate, not tested" />}
            {usesWeight(type) && <Stat label="Most reps" value={prog.bests.maxReps ?? '–'} sub="in one set" />}
            <Stat label="Total volume" value={usesWeight(type) ? fmtVolume(prog.totalVolume, unit) : `${fmtNum(prog.totalVolume, 0)} reps`} />
            <Stat label="Sessions" value={prog.points.length} sub={`since ${fmtDate(prog.points[0].session.started_at, { month: 'short', year: 'numeric' })}`} />
          </div>

          <section className="section">
            <div className="card chart-card">
              {metrics.length > 1 && <Segmented value={metric} onChange={setMetric} options={metrics} />}
              <div className="chart-card__unit faint">
                {metric === 'weight' ? 'Heaviest set per session' : metric === 'e1rm' ? 'Best estimated 1RM per session (Epley, 1–12 reps)' : metric === 'reps' ? 'Most reps in a set' : metric === 'volume' ? 'Total per session' : 'Best per session'}
                {yUnit && ` · ${yUnit}`}
              </div>
              <LineChart points={chart} formatY={formatY} />
            </div>
          </section>

          {usesWeight(type) && prog.repRecords.length > 0 && (
            <section className="section">
              <div className="section-head">
                <span className="section-title">Rep records</span>
              </div>
              <div className="list">
                {prog.repRecords.slice(0, 8).map((r) => (
                  <div key={r.weightKg} className="list-row" style={{ minHeight: 46 }}>
                    <span className="num" style={{ fontWeight: 600, width: 90 }}>{fmtWeight(r.weightKg, unit)}</span>
                    <span className="list-row__main num">× {r.reps}</span>
                    <span className="list-row__trail">{fmtDate(r.date, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <span className="section-title">Sessions</span>
            </div>
            <div className="list">
              <div className="list-row history-head">
                <span style={{ width: 70 }}>Date</span>
                <span style={{ flex: 1 }}>Top set</span>
                <span style={{ width: 40, textAlign: 'right' }}>Sets</span>
                <span style={{ width: 16 }} />
              </div>
              {[...prog.points].reverse().map((p) => (
                <button key={p.we.id} className="list-row" style={{ minHeight: 50 }} onClick={() => setOpen(p)}>
                  <span className="num muted" style={{ width: 70, fontSize: 14 }}>{fmtDate(p.session.started_at, { month: 'short', day: 'numeric' })}</span>
                  <span className="num" style={{ flex: 1, fontWeight: 600 }}>
                    {p.stats.topSet ? fmtSet(p.stats.topSet, type, unit) : '–'}
                    {p.isPR && <Trophy size={14} className="accent" style={{ marginLeft: 6, verticalAlign: -2 }} />}
                  </span>
                  <span className="num muted" style={{ width: 40, textAlign: 'right' }}>{p.stats.completedSets}</span>
                  <ChevronRight size={16} className="faint" />
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? fmtDate(open.session.started_at, { weekday: 'long', month: 'long', day: 'numeric' }) : ''}>
        {open && (
          <>
            <div className="muted" style={{ marginBottom: 10 }}>{open.session.workout_name_snapshot}</div>
            <div className="ro-sets">
              {open.sets.map((s) => (
                <div key={s.id} className="ro-set">
                  <span className="ro-set__n num">{s.set_number}</span>
                  <span className="num">{fmtSet(s, type, unit)}</span>
                  {usesWeight(type) && <span className="faint" style={{ fontSize: 13 }}>{unit}</span>}
                </div>
              ))}
            </div>
            {open.we.notes && <p className="muted" style={{ marginTop: 10 }}>{open.we.notes}</p>}
            <button className="btn btn--block" style={{ marginTop: 16 }} onClick={() => navigate(`/history/${open.session.id}`)}>
              Open full workout
            </button>
          </>
        )}
      </Sheet>
    </div>
  );
}
