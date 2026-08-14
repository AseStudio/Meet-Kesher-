// Must be served from your web app's ROOT (e.g. https://yourapp.com/service-worker.js)
// for its scope to cover the whole app — a service worker registered from
// /foo/service-worker.js can only control pages under /foo/.
//
// Where this file needs to physically live depends on your Expo web
// build setup — commonly a `public/` (or `web/`) folder whose contents
// get copied as-is to the web build's output root. If /service-worker.js
// 404s once deployed, that's the first thing to check — this file didn't
// move; if it's not underneath /mnt/user-data/outputs's project path,
// it's not being served from where the browser expects it.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // ignore malformed payloads
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Kesher', {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});