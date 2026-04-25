# 📊 Метрики paywall-кліків

Мета: побачити, які саме Pro-фічі найчастіше «провокують» Free-юзерів натискати на замок → це покаже, що реально варто продавати, а що ні.

---

## 1. База даних: таблиця `paywall_events`

Через міграцію створимо таблицю-журнал кліків:

| Поле | Тип | Опис |
|---|---|---|
| `id` | uuid PK | — |
| `user_id` | uuid → auth.users | хто клікнув |
| `feature_key` | text | напр. `ai_summary`, `premium_analytics`, `payment_reminder`, `bulk_actions`, `subscription_page_visit` |
| `source` | text | звідки прийшов клік (`lesson_workspace`, `finances`, `sidebar`, `dashboard` тощо) |
| `subscription_status` | text | статус юзера на момент кліку (`free`/`trial`/`active`) — щоб не плутати «розвідку» Free-юзерів з кліками Pro |
| `metadata` | jsonb | вільне поле (lesson_id, plan тощо) |
| `created_at` | timestamptz default now() | — |

**RLS:**
- INSERT — будь-який авторизований юзер (тільки `user_id = auth.uid()`).
- SELECT — лише `manager`.
- Індекси: `(feature_key, created_at)`, `(user_id, created_at)`.

---

## 2. Хук `usePaywallTracking`

Створю `src/hooks/usePaywallTracking.ts` з функцією:

```ts
trackPaywallClick(featureKey, source, metadata?)
```

— робить fire-and-forget INSERT, не чекає відповіді (UI не блокується). Сам підтягне поточний `subscription_status` з `useWorkspaceSettings`.

---

## 3. Інструментація існуючих paywall-точок

Додам виклик `trackPaywallClick` у місцях, де Free-юзер натикається на замок або переходить на `/subscription`:

| Місце | feature_key | Коли спрацьовує |
|---|---|---|
| `LessonWorkspace.tsx` — кнопка «✨ AI-конспект (Pro)» | `ai_summary` | onClick на заблокованій кнопці |
| `PremiumAnalyticsPage.tsx` — редірект Free → /subscription | `premium_analytics` | в useEffect перед navigate |
| `FinancesPage.tsx` — кнопки масових дій (якщо вирішимо ґейтити їх для Free) | `bulk_actions` | onClick |
| `FinancesPage.tsx` — нагадування про оплату (Pro-фіча) | `payment_reminder` | onClick |
| `SubscriptionPage.tsx` — візит | `subscription_page_visit` | в useEffect, з `?from=` параметром у URL |
| Sidebar / Dashboard банер «Trial / Upgrade» | `upgrade_banner` | onClick |

> Pro/Trial-юзери теж трекаються (це важливо для воронки), але в дашборді ми зможемо фільтрувати по `subscription_status = 'free'`.

---

## 4. Дашборд для менеджера: `/paywall-metrics`

Нова сторінка (тільки для `manager`), доступна з сайдбара поруч з «Аудит». Зміст:

- **Топ-фічі за кліками Free-юзерів** (за останні 7/30/90 днів) — горизонтальний bar-chart.
- **Унікальні юзери на фічу** — скільки реальних людей клікнули (не просто кліків).
- **Conversion-funnel:** клік на paywall → візит `/subscription` → апгрейд (`subscription_status` змінився на `active` після кліку). Дає простий «click→pay» % на фічу.
- **Таблиця останніх 100 подій** (для якісного аналізу: хто, коли, звідки).
- Фільтри: період, `feature_key`, `subscription_status`.

Графіки — на базі вже використовуваного `recharts` (як у `FinanceWeeklyChart`).

---

## ❓ Що уточнити перед стартом

1. **Назва таблиці:** `paywall_events` ок чи хочеш `feature_interest_events` / щось інше?
2. **Де розмістити дашборд:**
   - (a) окрема сторінка `/paywall-metrics` у сайдбарі менеджера, **або**
   - (b) додати таб всередину існуючої `PremiumAnalyticsPage` (вона зараз для тьюторів — довелось би роздвоїти за роллю)?
3. **Чи трекати візити `/subscription` з параметром `?from=...`** (звідки прийшов)? Це дає повну воронку, але потребує додавати `?from=ai_summary` у всі `navigate("/subscription")`.
4. **Ґейтити Bulk-actions і Payment reminders для Free** прямо зараз, чи поки лише трекати інтерес без блокування?

Підтвердь або скоригуй — і я іду робити.
