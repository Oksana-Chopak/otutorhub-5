# oTutorHub — Release Audit (June code)

> Свіжий аудит проти **поточного прод-коду** (`origin/main`, 13 червня), а не старого знімка.
> 6 паралельних аудиторів (статичні перевірки, security/RLS, i18n, дизайн-система, 4 ролі, a11y/perf) → 56 знахідок → синтез.
> Гейти: `tsc` ✅ 0 · `check-i18n` ✅ (2469) · `check-ux` ✅ (0 помилок) · `vite build` ✅ · **`check-hardcode` ❌ (377 / ліміт 50)**.

## P0 — блокери релізу

| # | Роль | Що | Файл | Фікс |
|---|---|---|---|---|
| P0-1 ✅ | all | **`check-hardcode` гейт — ЗЕЛЕНИЙ.** Оркестрований sweep (45 агентів, по файлу) обгорнув ~719 рядків у `t()` + ключі uk/en/sv (зведено вручну, 34 колізії пропущено). **377 → 12** (ліміт 50). Усі 4 гейти зелені вперше. | `45 файлів + локалі` | ✅ зроблено. |
| P0-2 | manager | **Менеджер читає уроки незалежних репетиторів** — RLS-ізоляція зламана в БД. Політику `lessons_select` (manager OR без фільтра source) ніколи не дропнули; isolation-fix лише додав «hub only», а Postgres ORить permissive-політики → `source='independent'` знову видимі. Клієнтський `.neq('source','independent')` обходиться прямим PostgREST-запитом з anon-ключем. | `migrations/20260506082107…:6` | Нова міграція: manager-гілку `lessons_select` → `has_role(...,'manager') AND (source='hub' OR source IS NULL)`. |
| P0-3 | manager | **Менеджер читає приватні ціни незалежних** (`student_rates`). Політика `Manager manages student rates` (FOR ALL, без фільтра) не дропнута; а isolation-fix `Manager sees hub rates only` **зламаний — посилається на неіснуючу таблицю `public.workspace_settings`** (є лише `tutor_workspace_settings`). | `migrations/20260418114910…:22` | Звузити manager-політику + переписати fix на `tutor_workspace_settings`. |

## P1 — важливе

| # | Роль | Що | Файл |
|---|---|---|---|
| P1-1 | manager | Менеджер читає **вкладення уроків незалежних** (метадані + приватні файли в storage) — RLS без фільтра source. | `migrations/20260511202330…:64` |
| P1-2 | all | **SchedulePage ковтає помилку** запиту уроків → порожній розклад без тоста/ретраю (не відрізнити від «немає уроків»). | `SchedulePage.tsx:403` |
| P1-3 | all | **Чат вантажить усі повідомлення** без `.limit()` і без віртуалізації — довгий тред монтує всю історію щоразу. | `ChatsPage.tsx:405` |
| P1-4 | all | **i18n-хардкод (377 рядків)** по екранах: OnboardingFlowB (86), SubscriptionPage (37, paywall), ChatsPage (17, **нова чат-фіча**), FinancesPage (28), MyStudentsPage (16), кабінет учня (платежі/домашки/дашборд/онбординг), mid-tier ~96 у 9 шеред-компонентах. en/sv бачать українську. |
| P1-5 | all | **Захардкоджена локаль `uk-UA`** у форматуванні дат/чисел: `currency.ts:36` (центральний `formatPrice`!) + 79 сайтів у 36 файлах. sv/en бачать укр. місяці/розряди. Лише 3 файли беруть локаль з `i18n.language`. | `lib/currency.ts:36` |
| P1-6 | all | **Хардкод-тости** проскакують `check-i18n` (він лише звіряє ключі): `DashboardPage:757/760`, `FinancesPage:1509`, тощо. |
| P1-7 | all | **Негативні empty-state** («Немає X») всупереч правилу CLAUDE.md + неперекладені: `DashboardPage:1904`, `FinancesPage:1456`, `FinanceWeeklyChart:134`. |
| P1-8 | all | **Ручні тернарні плюрали** замість i18next (`урок/уроки/уроків`) — неперекладні, часто граматично хибні: `DashboardPage:1094` та ін. |
| P1-9 | all | **a11y:** мобільна таб-навігація тьютора/менеджера — лише іконки, без `aria-label`, активний стан лише кольором. | `MobileBottomNav.tsx:90` |
| P1-10 | all | **a11y:** інпути діалогів мають `<span>`-лейбли замість `<label>` → немає доступного імені. | `QuickAddStudentDialog.tsx:247` |
| P1-11 | all | **a11y:** біла на teal `#2BBFAA` — контраст 2.3:1 (WCAG AA треба 4.5:1). Це головна CTA (~48 файлів). | `PageHeader.tsx:27` |

## P2 — полірування (зокрема нова фіча досягнень)

- **P2-1 (нова фіча):** ґрід досягнень — назва 10px / лічильник 9px, нижче мінімуму. `StudentAchievementsGrid.tsx:41`
- **P2-2 (нова фіча):** сторінка досягнень — shadcn `<Card rounded-lg>` (8px) + семантичні токени, тоді як інші екрани учня — inline `borderRadius:16/18` + `#eceef3`. CLAUDE.md: `rounded-[16px]`. `StudentAchievementsPage.tsx:26`
- **P2-3 (нова фіча):** empty-state досягнень «Поки що порожньо» — негативне обрамлення. `uk.ts` `studentAchievements.empty`
- **P2-4:** багато i18n empty-state значень з «Немає X». **P2-5:** `toasts.ts` хардкод-укр + у SKIP. **P2-6:** 37 `{{count}}`-ключів без плюралів. **P2-7:** `StudentLayout` тема/мова `h-9`. **P2-8:** `QuickActionsCard` поля `h-10 md:h-9`. **P2-9:** icon-кнопки без `aria-label`. **P2-10:** низький контраст inline `#9398b0/#b0b4c8`. **P2-11:** N+1 нотифікації в борг-нагадуванні. **P2-12:** `SubscriptionRequestDialog` не bottom-sheet. **P2-13:** e2e не запускається (нема `.env.e2e`), 0 покриття нових фіч.

## P3 — дрібне

Бандл 488 kB (норма) · non-constant-time порівняння CRON_SECRET · `.env` трекнутий (лише публічний anon-ключ) · сторінка досягнень не в постійній нав учня · спінер замість скелетона · хардкод-hex (значення збігаються з токенами) · надлишкові `_few/_many` у en/sv.

## Що з цього стосується наших нових фіч
Нові файли (achievements lib/hook/grid/page, RewardCollection, hub-manager RPC/міграція) — **чисті від хардкод-рядків** (підтверджено). Дотичні до фіч: P2-1/2/3 (стиль ґріда/картки/empty-state досягнень) і частково P1-4 (ChatsPage хардкод — переважно червневий код, не наші правки).

---
_Гілка `release-audit` = `origin/main` + 2 фіче-коміти. `main` недоторканий. Стара (травнева) робота — `release-audit-backup`._
