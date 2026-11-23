/* LiftLog service worker — precaches the built app so it opens instantly and offline.
   The build step replaces the two placeholders below (see vite.config.ts). */
const CACHE = 'liftlog-__CACHE_VERSION__';
const PRECACHE = __PRECACHE_LIST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('liftlog-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase etc. go straight to the network

  // App shell: serve the cached index instantly (works in a gym with no signal).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./', { ignoreSearch: true }).then((cached) => cached || fetch(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

/* ---------------- Notifications ---------------- */
// Only one kind of notification exists: "Rest over". It is never silent, so the phone
// plays its normal alert — on an iPhone in silent mode that means the vibration.

const WORKOUT_URL = new URL('./#/workout', self.registration.scope).href;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Rest over', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rest over', {
      body: data.body || 'Time for your next set.',
      tag: data.tag || 'rest',
      renotify: true,
      silent: false,
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: WORKOUT_URL },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list[0];
      if (client) {
        // App is running (or suspended): bring it forward on the workout screen.
        client.postMessage({ type: 'open-workout' });
        if ('focus' in client) return client.focus();
        return;
      }
      // App was closed: open it straight on the workout.
      return self.clients.openWindow(WORKOUT_URL);
    }),
  );
});
