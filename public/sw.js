// oTutorHub Service Worker — handles Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'oTutorHub', body: '', link: '/' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* ignore */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: 'otutorhub-notif',
      data: { link: payload.link },
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        const existing = list.find((c) => c.url.startsWith(self.location.origin));
        if (existing) {
          existing.focus();
          return existing.navigate(link);
        }
        return clients.openWindow(link);
      })
  );
});
