// Pulled into the generated service worker (vite.config.ts → workbox.importScripts). Shows the nightly reminder from api/push.ts.
self.addEventListener('push', e => {
  const { title, body } = e.data.json();
  e.waitUntil(self.registration.showNotification(title, { body, icon: '/pwa-192.png', tag: 'remind' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws[0]?.focus() ?? clients.openWindow('/')));
});
