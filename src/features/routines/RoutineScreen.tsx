import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Copy,
  Ellipsis,
  Library,
  Pencil,
  Plus,
  Trash2,
  Check,
} from 'lucide-react';
import { useDb } from '../../lib/db';
import { activeRoutine, dayExercises, isDayUsed, listRoutines, routineDays } from '../../lib/queries';
import {
  archiveDay,
  createDay,
  createRoutine,
  deleteDay,
  duplicateDay,
  renameRoutine,
  reorder,
  restoreDay,
  setActiveRoutine,
} from '../../lib/actions';
import { ActionSheet, EmptyState, Field, Sheet, showToast } from '../../components/ui';
import { SortableList } from '../../components/SortableList';
import { WEEKDAY_SHORT, WEEK_ORDER } from '../../utils/dates';
import type { RoutineDay } from '../../types/models';

export function RoutineScreen() {
  const db = useDb();
  const navigate = useNavigate();
  const routine = activeRoutine(db);
  const days = routineDays(db.tables, routine?.id);
  const archived = routineDays(db.tables, routine?.id, true);
  const [menuDay, setMenuDay] = useState<RoutineDay | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="page">
      <header className="page-header">
        <button className="routine-title" onClick={() => setRoutineOpen(true)}>
          <span className="page-title">{routine?.name ?? 'Routine'}</span>
          <ChevronDown size={18} className="faint" />
        </button>
        <div className="row" style={{ gap: 0 }}>
          <Link to="/routine/exercises" className="icon-btn" aria-label="Exercise library">
            <Library size={22} />
          </Link>
          <button className="icon-btn" aria-label="New training day" onClick={() => setNewOpen(true)}>
            <Plus size={24} />
          </button>
        </div>
      </header>

      {days.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Plus size={24} />} title="No training days yet">
            <p style={{ marginBottom: 16 }}>Create days like Push, Upper Body or Full Body — whatever your split is.</p>
            <button className="btn btn--primary btn--lg" onClick={() => setNewOpen(true)}>
              Create training day
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 13, margin: '0 4px 10px' }}>
            Drag to reorder. Tap a day to edit exercises and schedule.
          </p>
          <SortableList
            items={days}
            onReorder={(next) => reorder('routine_days', next)}
            renderItem={(d, handle) => {
              const count = dayExercises(db.tables, d.id).length;
              return (
                <div className="card day-card">
                  {handle}
                  <button className="day-card__main" onClick={() => navigate(`/routine/day/${d.id}`)}>
                    <div className="day-card__name">{d.name}</div>
                    {d.description && <div className="day-card__focus">{d.description}</div>}
                    <div className="day-card__meta">
                      <span>{count} {count === 1 ? 'exercise' : 'exercises'}</span>
                      {d.scheduled_weekdays.length > 0 && (
                        <span className="day-card__days">
                          {WEEK_ORDER.filter((w) => d.scheduled_weekdays.includes(w)).map((w) => (
                            <span key={w} className="chip">
                              {WEEKDAY_SHORT[w]}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </button>
                  <button className="icon-btn" aria-label={`More for ${d.name}`} onClick={() => setMenuDay(d)}>
                    <Ellipsis size={20} />
                  </button>
                </div>
              );
            }}
          />
          <button className="btn btn--block" style={{ marginTop: 12 }} onClick={() => setNewOpen(true)}>
            <Plus size={18} /> New training day
          </button>
        </>
      )}

      {archived.length > 0 && (
        <section className="section">
          <button className="section-head" style={{ width: '100%' }} onClick={() => setShowArchived((v) => !v)}>
            <span className="section-title">Archived ({archived.length})</span>
            <ChevronDown size={16} className="faint" style={{ transform: showArchived ? 'rotate(180deg)' : undefined }} />
          </button>
          {showArchived && (
            <div className="list">
              {archived.map((d) => (
                <div key={d.id} className="list-row">
                  <div className="list-row__main">
                    <div className="list-row__title muted">{d.name}</div>
                    <div className="list-row__sub">{dayExercises(db.tables, d.id).length} exercises</div>
                  </div>
                  <button className="btn btn--sm" onClick={() => restoreDay(d.id)}>
                    <ArchiveRestore size={16} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ActionSheet
        open={!!menuDay}
        onClose={() => setMenuDay(null)}
        title={menuDay?.name}
        actions={
          menuDay
            ? [
                { label: 'Edit', icon: <Pencil size={20} />, onClick: () => navigate(`/routine/day/${menuDay.id}`) },
                { label: 'Duplicate', icon: <Copy size={20} />, onClick: () => duplicateDay(menuDay.id) },
                {
                  label: 'Archive',
                  icon: <Archive size={20} />,
                  onClick: () => {
                    const id = menuDay.id;
                    archiveDay(id);
                    showToast(`${menuDay.name} archived`, { label: 'Undo', onClick: () => restoreDay(id) });
                  },
                },
                {
                  label: 'Delete',
                  icon: <Trash2 size={20} />,
                  danger: true,
                  hidden: isDayUsed(db.tables, menuDay.id),
                  onClick: () => {
                    deleteDay(menuDay.id);
                    showToast(`${menuDay.name} deleted`);
                  },
                },
              ]
            : []
        }
      />

      <NewDaySheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(name, focus) => {
          const d = createDay(name, focus || null);
          setNewOpen(false);
          navigate(`/routine/day/${d.id}`);
        }}
      />

      <RoutineSheet open={routineOpen} onClose={() => setRoutineOpen(false)} />
    </div>
  );
}

function NewDaySheet({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string, focus: string) => void }) {
  const [name, setName] = useState('');
  const [focus, setFocus] = useState('');
  const close = () => {
    setName('');
    setFocus('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="New training day">
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onCreate(name, focus);
          setName('');
          setFocus('');
        }}
      >
        <Field label="Name">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Push, Upper Body, Arms…" />
        </Field>
        <Field label="Focus (optional)">
          <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Chest · Shoulders · Triceps" />
        </Field>
        <button className="btn btn--primary btn--lg btn--block" disabled={!name.trim()}>
          Create day
        </button>
      </form>
    </Sheet>
  );
}

function RoutineSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb();
  const current = activeRoutine(db);
  const routines = listRoutines(db.tables);
  const [newName, setNewName] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title="Routines">
      <div className="stack" style={{ gap: 14 }}>
        {current && (
          <Field label="Name">
            <input className="input" value={current.name} onChange={(e) => renameRoutine(current.id, e.target.value)} />
          </Field>
        )}
        {routines.length > 1 && (
          <div className="list">
            {routines.map((r) => (
              <button
                key={r.id}
                className="list-row"
                onClick={() => {
                  setActiveRoutine(r.id);
                  onClose();
                }}
              >
                <span className="list-row__main">{r.name}</span>
                {r.id === current?.id && <Check size={18} className="accent" />}
              </button>
            ))}
          </div>
        )}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createRoutine(newName);
            setNewName('');
            onClose();
          }}
        >
          <input className="input" placeholder="New routine name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn" disabled={!newName.trim()}>
            Create
          </button>
        </form>
        <p className="faint" style={{ fontSize: 13 }}>
          Most people only need one routine. Create another when you switch programs — history is kept either way.
        </p>
      </div>
    </Sheet>
  );
}
