// oTutorHub Service Worker — handles Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'oTutorHub', body: '', link: '/' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* ignore */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // A2: було logo.png 84 kB на кожне сповіщення — тепер готові іконки
      // правильних розмірів (192 для картинки, 48 для бейджа).
      icon: '/icon-192.png',
      badge: '/favicon-48.png',
      tag: payload.tag || 'otutorhub-' + Date.now(),
      data: { link: payload.link },
      requireInteraction: false,
    })
  );
});

// Only ever navigate to a SAME-ORIGIN path. A notification link is attacker-influenceable
// (it flows from create_notification's _link), so an absolute/protocol-relative URL could
// redirect the logged-in tab to a phishing site. Resolve against our origin and keep only
// same-origin links; anything else falls back to the app root.
function safeLink(raw) {
  try {
    const u = new URL(raw ?? '/', self.location.origin);
    if (u.origin === self.location.origin) return u.pathname + u.search + u.hash;
  } catch { /* fall through */ }
  return '/';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = safeLink(event.notification.data?.link);
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
