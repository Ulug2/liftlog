import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { HashRouter, MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { ToastHost } from '../components/ui';
import { useDb } from '../lib/db';
import { syncConfigured } from '../lib/supabase';
import { workoutIndex } from '../lib/queries';
import { HomeScreen } from '../features/home/HomeScreen';
import { RoutineScreen } from '../features/routines/RoutineScreen';
import { DayEditor } from '../features/routines/DayEditor';
import { ExerciseLibrary } from '../features/routines/ExerciseLibrary';
import { ActiveWorkout } from '../features/workout/ActiveWorkout';
import { WorkoutSummary } from '../features/workout/WorkoutSummary';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { SessionDetail } from '../features/history/SessionDetail';
import { AuthScreen } from '../features/auth/AuthScreen';

// Less-frequently used screens are split out so Home and the workout open instantly.
const ProgressScreen = lazy(() => import('../features/progress/ProgressScreen'));
const ExerciseProgressScreen = lazy(() => import('../features/progress/ExerciseProgress'));
const SettingsScreen = lazy(() => import('../features/settings/SettingsScreen'));

const TAB_ROOTS = ['/', '/routine', '/progress', '/history'];
const depth = (p: string) => p.split('/').filter(Boolean).length;

/** Pick a page transition: tabs cross-fade, drilling in slides from the right, going back from the left. */
function useRouteTransition(pathname: string) {
  const prev = useRef(pathname);
  const cls = useRef('route--fade');
  if (prev.current !== pathname) {
    const a = prev.current;
    const b = pathname;
    if (TAB_ROOTS.includes(a) && TAB_ROOTS.includes(b)) cls.current = 'route--fade';
    else if (depth(b) > depth(a) || (b === '/settings' && a === '/')) cls.current = 'route--push';
    else cls.current = 'route--pop';
    prev.current = pathname;
  }
  return cls.current;
}

function Layout() {
  const { pathname } = useLocation();
  const transition = useRouteTransition(pathname);
  const scroller = useRef<HTMLDivElement>(null);

  // New page → start at the top.
  useLayoutEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app-shell">
      <div className="app-scroll" ref={scroller} id="scroller">
        <div key={pathname} className={`route ${transition}`}>
          <Suspense fallback={<div className="page" />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

/** On launch, jump straight back into an unfinished workout. */
function RestoreWorkout() {
  const db = useDb();
  const navigate = useNavigate();
  const location = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !db.ready) return;
    done.current = true;
    if (workoutIndex(db.tables).active && location.pathname === '/') navigate('/workout');
  }, [db.ready, db.tables, location.pathname, navigate]);
  return null;
}

// The hosted preview runs in a sandboxed frame, so it keeps routes in memory instead of the URL hash.
const Router = import.meta.env.VITE_ROUTER === 'memory' ? MemoryRouter : HashRouter;

export function App() {
  const db = useDb();
  if (!db.ready || (syncConfigured && !db.sync.authChecked)) return <div className="boot" />;
  if (syncConfigured && !db.sync.userId) return <AuthScreen />;
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RestoreWorkout />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeScreen />} />
          <Route path="routine" element={<RoutineScreen />} />
          <Route path="routine/day/:dayId" element={<DayEditor />} />
          <Route path="routine/exercises" element={<ExerciseLibrary />} />
          <Route path="progress" element={<ProgressScreen />} />
          <Route path="progress/exercise/:exerciseId" element={<ExerciseProgressScreen />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="history/:sessionId" element={<SessionDetail />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<HomeScreen />} />
        </Route>
        <Route path="workout" element={<ActiveWorkout />} />
        <Route path="summary/:sessionId" element={<WorkoutSummary />} />
      </Routes>
      <ToastHost />
    </Router>
  );
}
