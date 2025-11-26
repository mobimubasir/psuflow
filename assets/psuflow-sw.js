// assets/psuflow-sw.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Minimal SW: we only need it so reg.showNotification works reliably.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Focus an existing PSUFlow tab or open one
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.includes('/studentdashboard')) { client.focus(); return; }
    }
    await self.clients.openWindow('/studentdashboard');
  })());
});
