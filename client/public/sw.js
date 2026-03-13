// WAK Solutions Agent - Service Worker
const CACHE_NAME = 'wak-agent-v2';

self.addEventListener('install', (event) => {
  // Skip caching offline.html — not critical, avoids install failures
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((r) => r || new Response('Offline', { status: 503 }));
    })
  );
});

self.addEventListener('push', (event) => {
  // iOS requires showNotification to be called inside event.waitUntil ALWAYS.
  // Never exit early without calling showNotification — iOS will kill the SW.
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'WAK Solutions', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'WAK Solutions Agent';
  const isIOS = /iPad|iPhone|iPod/.test(self.navigator?.userAgent || '') ||
    (self.navigator?.platform === 'MacIntel' && self.navigator?.maxTouchPoints > 1);

  const options = {
    body: data.body || 'New notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || ('wak-' + Date.now()),
    renotify: true,
    vibrate: [200, 100, 200, 100, 400],
    data: { url: data.url || '/' }
  };

  // iOS does not support requireInteraction — only set on non-iOS
  if (!isIOS) {
    options.requireInteraction = true;
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (client.navigate) client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
