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

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'LiftLog', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LiftLog', {
      body: data.body || '',
      tag: data.tag || 'liftlog',
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
