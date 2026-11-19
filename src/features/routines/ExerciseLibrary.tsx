import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronLeft, Plus, Search, TrendingUp } from 'lucide-react';
import { useDb } from '../../lib/db';
import { listExercises } from '../../lib/queries';
import { archiveExercise, createExercise, restoreExercise, updateExercise } from '../../lib/actions';
import { ExerciseForm, typeLabel } from '../../components/ExerciseForm';
import { Segmented, Sheet, showToast } from '../../components/ui';

export function ExerciseLibrary() {
  const db = useDb();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const all = listExercises(db.tables, true);
  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all
      .filter((e) => (tab === 'archived' ? !!e.archived_at : !e.archived_at))
      .filter((e) => terms.every((t) => `${e.name} ${e.equipment ?? ''} ${e.category ?? ''}`.toLowerCase().includes(t)));
  }, [all, q, tab]);
  const ex = editing && editing !== 'new' ? db.tables.exercises[editing] : null;

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-btn" style={{ marginLeft: -12 }} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={26} />
        </button>
        <div className="page-title" style={{ flex: 1, fontSize: 18 }}>
          Exercises
        </div>
        <button className="icon-btn" onClick={() => setEditing('new')} aria-label="New exercise">
          <Plus size={24} />
        </button>
      </header>
      <div className="stack" style={{ gap: 10 }}>
        <div className="search">
          <Search size={18} />
          <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {shown.map((e) => (
          <button key={e.id} className="list-row" onClick={() => setEditing(e.id)}>
            <div className="list-row__main">
              <div className="list-row__title">{e.name}</div>
              <div className="list-row__sub">
                {[e.equipment, typeLabel(e.exercise_type), e.category].filter(Boolean).join(' · ')}
              </div>
            </div>
          </button>
        ))}
        {shown.length === 0 && <div className="list-row muted">{tab === 'archived' ? 'No archived exercises.' : 'No exercises yet.'}</div>}
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New exercise' : 'Edit exercise'}>
        {editing === 'new' ? (
          <ExerciseForm
            submitLabel="Create exercise"
            onSubmit={(d) => {
              createExercise(d);
              setEditing(null);
            }}
          />
        ) : (
          ex && (
            <ExerciseForm
              key={ex.id}
              initial={ex}
              onSubmit={(d) => {
                updateExercise(ex.id, d);
                setEditing(null);
              }}
              extra={
                <div className="stack">
                  <button className="btn btn--block" type="button" onClick={() => navigate(`/progress/exercise/${ex.id}`)}>
                    <TrendingUp size={18} /> View progress
                  </button>
                  {ex.archived_at ? (
                    <button
                      className="btn btn--block"
                      type="button"
                      onClick={() => {
                        restoreExercise(ex.id);
                        setEditing(null);
                      }}
                    >
                      <ArchiveRestore size={18} /> Restore
                    </button>
                  ) : (
                    <button
                      className="btn btn--danger btn--block"
                      type="button"
                      onClick={() => {
                        archiveExercise(ex.id);
                        setEditing(null);
                        showToast(`${ex.name} archived — history kept`, { label: 'Undo', onClick: () => restoreExercise(ex.id) });
                      }}
                    >
                      <Archive size={18} /> Archive
                    </button>
                  )}
                </div>
              }
            />
          )
        )}
      </Sheet>
    </div>
  );
}
