// oTutorHub Service Worker — handles Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'oTutorHub', body: '', link: '/' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* ignore */ }

  // ВАЖІЛЬ 3в (аудит шляхів 24.09): кнопки в САМОМУ сповіщенні — «Я оплатив»,
  // «Приєднатися». Кнопка нічого не пише сама: у service worker немає сесії
  // людини, тож запис грошей звідси вимагав би підписаного одноразового токена
  // — нова поверхня для атаки. Кнопка веде ГЛИБОКИМ посиланням із уже
  // наведеною дією, а сам запис лишається в застосунку під сесією людини.
  const raw = Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [];
  const actions = [];
  const actionLinks = {};
  for (const a of raw) {
    if (!a || typeof a.action !== 'string' || typeof a.title !== 'string') continue;
    actions.push({ action: a.action, title: a.title });
    actionLinks[a.action] = a.link;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // A2: було logo.png 84 kB на кожне сповіщення — тепер готові іконки
      // правильних розмірів (192 для картинки, 48 для бейджа).
      icon: '/icon-192.png',
      badge: '/favicon-48.png',
      tag: payload.tag || 'otutorhub-' + Date.now(),
      data: { link: payload.link, actionLinks },
      ...(actions.length ? { actions } : {}),
      requireInteraction: false,
    })
  );
});

// Only ever navigate to a SAME-ORIGIN path. A notification link is attacker-influenceable
// (it flows from create_notification's _link), so an absolute/protocol-relative URL could
// redirect the logged-in tab to a phishing site. Resolve against our origin and keep only
// same-origin links; anything else falls back to the app root. Те саме правило діє і для
// посилань кнопок: вони приходять тим самим каналом, отже довіри мають стільки ж.
function safeLink(raw) {
  try {
    const u = new URL(raw ?? '/', self.location.origin);
    if (u.origin === self.location.origin) return u.pathname + u.search + u.hash;
  } catch { /* fall through */ }
  return '/';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Натиснули кнопку → її шлях; натиснули саме сповіщення → загальний link.
  const target = event.action && data.actionLinks ? data.actionLinks[event.action] : data.link;
  const link = safeLink(target ?? data.link);
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
