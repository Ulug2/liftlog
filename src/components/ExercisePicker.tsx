import { useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { useDb } from '../lib/db';
import { listExercises } from '../lib/queries';
import { createExercise } from '../lib/actions';
import { ExerciseForm, typeLabel } from './ExerciseForm';
import { Sheet } from './ui';

/** Search the library or create a new exercise, then hand back its id. */
export function ExercisePicker({
  open,
  onClose,
  onPick,
  excludeIds = [],
  title = 'Add exercise',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exerciseId: string) => void;
  excludeIds?: string[];
  title?: string;
}) {
  const db = useDb();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const all = listExercises(db.tables);
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((e) => {
      const hay = `${e.name} ${e.equipment ?? ''} ${e.category ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [all, q]);

  const close = () => {
    setQ('');
    setCreating(false);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={creating ? 'New exercise' : title}>
      {creating ? (
        <ExerciseForm
          initial={{ name: q }}
          submitLabel="Create and add"
          onSubmit={(d) => {
            const ex = createExercise(d);
            onPick(ex.id);
            close();
          }}
        />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="search">
            <Search size={18} />
            <input className="input" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <button className="btn btn--block" onClick={() => setCreating(true)}>
            <Plus size={18} /> {q.trim() ? `Create “${q.trim()}”` : 'Create new exercise'}
          </button>
          {results.length > 0 ? (
            <div className="list">
              {results.map((e) => {
                const added = excludeIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    className="list-row"
                    onClick={() => {
                      onPick(e.id);
                      close();
                    }}
                  >
                    <div className="list-row__main">
                      <div className="list-row__title">{e.name}</div>
                      <div className="list-row__sub">
                        {[e.equipment, e.exercise_type !== 'weight' ? typeLabel(e.exercise_type) : null].filter(Boolean).join(' · ') || 'No equipment'}
                      </div>
                    </div>
                    {added && (
                      <span className="list-row__trail accent">
                        <Check size={16} /> Added
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ textAlign: 'center', padding: 16 }}>
              {all.length ? 'No matches.' : 'Your exercise library is empty. Create your first exercise.'}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
