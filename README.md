# LiftLog

A fast, offline-first personal workout tracker built as an iPhone-friendly PWA.

**Stack:** React 18 · TypeScript · Vite · plain CSS (CSS variables) · React Router · Lucide · Supabase (optional sync) · IndexedDB.
**Dependencies at runtime:** 5 (react, react-dom, react-router-dom, lucide-react, @supabase/supabase-js — the latter lazy-loaded only when sync is on).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ (service worker active)
```

The app works fully **without** Supabase: everything is stored on the device in IndexedDB.

## Live setup

- **Supabase project:** `liftlog` (`tqbldynnwryogarysijp`, us-east-1, free tier). Schema from `supabase/migrations/` is applied.
- **Client config:** `.env.production` holds the project URL and *publishable* key. These are public by design (they ship in the browser bundle); Row Level Security is what protects the data.
- **Hosting:** Vercel project `liftlog` (production: https://liftlog-ulykbek-s-projects.vercel.app), auto-deploying from `main` (`vercel.json` sets the build and cache headers for the service worker).

## Turn on cloud sync (Supabase) for a new project

1. Create a Supabase project.
2. Run `supabase/migrations/20261119000000_init.sql` (SQL editor, or `supabase db push`).
3. Authentication → Providers → Email: enabled. Turning off "Confirm email" is optional (makes sign-up instant).
4. Create `.env.local`:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```
5. Rebuild, open Settings → sign in. Existing local data is uploaded on first sign-in.

Email + password is used deliberately: magic links open in Safari, not in the Home Screen app, and iOS keeps those two storages separate.

## Deploy + install on iPhone

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages). Hash routing (`#/history`) means no rewrite rules are needed. HTTPS is required for the service worker.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**. It launches full-screen, respects the notch/home-indicator safe areas, and opens offline.

## How it's built

```
src/
  app/App.tsx            routes, launch-time workout restore
  lib/db.ts              in-memory store ⇄ IndexedDB, outbox (single source of truth)
  lib/storage.ts         tiny IndexedDB wrapper (localStorage fallback)
  lib/actions.ts         all writes: routines, workouts, sets, timers, skips
  lib/queries.ts         derived data: history index, previous performance, PRs, calendar
  lib/sync.ts            background push/pull with Supabase
  components/            Sheet, Stepper, SetTable, SortableList, LineChart, …
  features/              home · routines · workout · progress · history · settings
  styles/                variables.css (design tokens), global, components, features
supabase/migrations/     schema, RLS, sync triggers
public/                  manifest, service worker, icons
```

### Key decisions

- **Sign-in first.** With Supabase configured, the app opens on the sign-in screen. The session is stored on the device and refreshed automatically; only an explicit sign-out (or a revoked session) logs you out. Offline launches use the saved session.
- **App frame layout.** The document never scrolls; content scrolls inside a fixed frame and the tab bar is a normal flex child. This keeps iOS Safari's toolbar and rubber-band scrolling from moving the tab bar.
- **Motion** lives in `src/styles/motion.css`: tab cross-fades, push/pop slides, sheets that animate out, a sliding tab indicator, staggered lists, set-completion pops and chart draw-in. All of it is disabled when the phone's Reduce Motion setting is on.

- **Local-first.** Every tap writes to memory and IndexedDB immediately; the UI never waits for the network. Changed rows go into an outbox that syncs in the background.
- **Timers use timestamps, never intervals.** The workout keeps `started_at`, `paused_at`, `total_paused_seconds`; the rest timer keeps `endsAt`. Displayed time is recomputed from `Date.now()` on every tick and whenever the app becomes visible, so locking the phone or switching apps doesn't drift it.
- **History is immutable to routine edits.** Starting a workout snapshots each exercise's name, equipment, type and targets into `workout_exercises`. Renaming an exercise or changing 3 → 4 sets never rewrites old sessions.
- **Prefill, never auto-complete.** New sets copy weight and reps from the same set number last time (extra sets repeat the last one). They stay unchecked.
- **Weights are stored in kg** and converted for display. Switching units never changes data. Each exercise can override the unit (e.g. a machine labelled in kg).
- **Variations stay separate.** Cable Fly and Machine Fly are separate exercises; `category` is only for grouping.
- **Unknown ≠ zero.** Empty fields are `null`. Sessions have a `source` ('app' | 'import') so a future Apple Notes import can store incomplete data honestly.
- **Skips and rest days are `day_logs`**, never workouts. They don't count toward stats and don't move the schedule.
- **Sync conflicts:** client-generated UUIDs make uploads idempotent (no duplicate sessions on retry). Newest `updated_at` wins on both sides; a database trigger refuses stale overwrites. Deletes are soft (`deleted_at`) so they sync.
- **Estimated 1RM** uses Epley, only for weight × reps sets of 1–12 reps, and is labelled as an estimate.

### Timer notifications

iPhone web apps can't show a live, ticking Lock Screen timer (Live Activities are native-only), so LiftLog uses notifications instead (Settings → Notifications, or the prompt on the workout screen; the app must be installed to the Home Screen):

- When you leave the app mid-workout it posts **"Push in progress · started 6:05 PM"** and **"Resting · next set at 6:12:30 PM"** (with the next set's target), and schedules a **"Rest over"** push for the exact end time.
- Coming back to the app clears them and cancels the pending push; the in-app timer takes over (with a chime when rest ends).
- Server side: `push_subscriptions` + `notification_schedule` tables (RLS), a `pg_cron` job every 5 s that only wakes the `push` Edge Function when an alert is due, and a dependency-free Web Push sender (`supabase/functions/push/webpush.ts`, RFC 8291/8292). VAPID keys are generated inside Supabase on first use and never leave the server.

### iPhone caveats worth knowing

- iOS suspends JavaScript in the background; the rest-over alert therefore comes from the server as a push notification (see above). Without notifications enabled, the app shows "Rest complete" the moment you come back and the time is exact.
- iOS may clear site data for web apps that go unused for several weeks. Installing to the Home Screen and turning on sync protects against this. The app also asks for persistent storage.
- Screen wake lock keeps the display on during a workout on iOS 16.4+.

## Tests performed

An automated browser run at iPhone size (390×844) covering spec §21: build a day with exercises and targets, drag-reorder, start the workout, apply to remaining sets, edit sets independently, complete sets with the rest timer, check the timer stays accurate across a simulated 8-minute close/reopen, restore the unfinished workout (sets, values, current exercise), undo a set, pause the timer, add/remove a set, skip an exercise, finish → summary, check the second workout is prefilled with nothing auto-completed, edit the routine and rename an exercise without changing the old session, correct history, and skip a day with a reason without it counting as a workout.

## Later phases (not built yet)

- Apple Notes / CSV **import** (the data model is ready: nullable values, `source = 'import'`)
- Non-gym activity logging (futsal, walks): `activity_logs` table exists
- Light theme
