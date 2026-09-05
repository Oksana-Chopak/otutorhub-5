# oTutorHub — Project Context for Claude

## Project
- **Repo**: `Oksana-Chopak/otutorhub-5`
- **Prod**: `otutorhub.com`
- **Stack**: React + TypeScript + Tailwind + shadcn/ui + Supabase + i18next
- **Supabase project**: `kficbcjqcbhqhjimxfed`
- **Code generator**: Lovable (publishes to `main` branch)
- **Roles**: manager / tutor (hub) / tutor (independent) / student

> **START HERE → [`HANDOFF.md`](./HANDOFF.md)** — стан проєкту, шість пасток репозиторію,
> обовʼязковий ланцюг воріт, що вже закрито і що лишилось (з файлами й рядками).
> Читай його ДО першої правки. Цей файл (CLAUDE.md) — довідник по механіці; HANDOFF.md —
> що робити і чого не робити.

## Pre-release security/quality audit (2026-06-19) — fixes shipped, MUST be applied
Deep audit (37 agents) found 20 confirmed issues; all fixed in the repo. **Nothing is live
until Lovable applies/deploys it** (see Deploy model). Apply these in order:
- **DB migrations (ask Lovable to apply, in this order):** `20260621000000` (P0 isolation:
  managers↔independent), `20260622000000` (referral farming + notification spoofing/
  phishing), `20260623000000` (LOW: reward insert, definer read guards). Each is
  timestamped strictly above prior applied (ordering trap).
- **Edge functions (ask Lovable to redeploy):** `revenuecat-webhook` (tutor_id filter +
  subscription_until + referral bonus), `landing-find-tutor-quiz` (rate limit).
- **Frontend (ships via Publish):** `public/sw.js` (same-origin link), DashboardPage /
  PendingPaymentsCard / useStudentRewards / StudentProfilePage / chart i18n.
- **Verify after apply:** manager anon-key probe → `lessons?source=eq.independent` &
  `student_rates?source=eq.independent` return 0 rows (P0). Re-run the Lovable scan.
- **Known repo quirk (verified NO live gap):** duplicate migration VERSIONS exist —
  `20260617000000` (cancellation_rules + fix_ghost_role_carry) and `20260617000001`
  (student_tutor_notes + tutor_delete_student). Supabase records one version, so one of
  each pair was skipped, BUT: cancellation cols are live; merge_pending_profile is
  superseded by `20260617175401`; tutor_delete hardened by `20260617100003`; tutor_notes
  since dropped. Do NOT re-run the old files (would revert merge_pending_profile). Never
  reuse a timestamp — always unique + above latest.

## Critical Rules

### Git workflow
- Lovable publishes to `main` after every Publish — always `git pull` before editing
- After every commit: `npm run typecheck && npm run test && npm run build && node scripts/check-i18n.mjs && node scripts/check-ux.mjs`
- ⚠️ **NEVER use bare `npx tsc --noEmit` as the gate** (fixed 2026-09-01). The root
  `tsconfig.json` has `"files": []` and only `references`, so that command typechecks
  NOTHING and always prints 0 errors. `npm run build` is `vite build` — esbuild strips
  types without checking them. Together they let two `useEscapeKey` calls with no import
  reach `main`: the independent tutor's dashboard and the whole onboarding crashed into
  ErrorBoundary while every gate was green. Use `npm run typecheck`
  (`tsc -p tsconfig.app.json --noEmit`); it is also locked by
  `src/test/typecheck-gate.test.ts` so the suite fails if src stops compiling.
- Only push if ALL checks are green
- ⚠️ `npm run build` IS a required gate (added 2026-07-07 after a JSX-comment-after-`: (`
  in GroupsPage broke the store build but passed tsc+vitest — vitest only transforms
  files a test imports, and tsc's parser tolerated it; esbuild/vite did not. A
  `{/* */}` JSX comment is INVALID immediately after `? (` / `: (` in a ternary — it
  must be a `//` JS comment there. Always run the real build before pushing UI edits.
- After push — verify each changed page via Chrome extension before reporting done

### Deploy model — READ THIS (it has bitten the release twice)
Three independent channels — pushing to `main` does NOT deploy all of them:
- **Frontend code** (pages, components, hooks) → Lovable **Publish** ships it. Also visible in Lovable Preview immediately on git push, no Publish needed.
- **DB migrations** (`supabase/migrations/*.sql`) → NOT applied by Publish or by an external git push. They must be applied via Supabase (Dashboard SQL Editor, or ask Lovable chat to apply them). A migration sitting in the repo is NOT in prod until applied.
- **Edge functions** (`supabase/functions/*`) → same: NOT deployed by Publish/git push. Must be deployed via Supabase, AND must be listed in `supabase/config.toml` or they are skipped entirely.
- Verification trick: if a table/function/column shows up in `src/integrations/supabase/types.ts`, it IS in the live DB (Lovable regenerates types from the live DB after applying). If it's only in a migration file, it's NOT live yet.
- The old migrations/functions are in prod because they were originally run through the Lovable/Supabase pipeline — not because an external push applied them.

### FINANCE INVARIANTS — INVIOLABLE (added 01.08 after margin-zeroing bug)
- Hub margin (student_price − tutor_payout) is sacred. student_price and
  tutor_payout are INDEPENDENT values from INDEPENDENT sources
  (student_rates.price_per_lesson vs tutor_subject_rates/tutor_details rate).
- NEVER prefill/default one from the other in any UI or SQL. The PeoplePage
  add-subject prefill did exactly that and silently zeroed margins on prod.
- DISPLAY: money fields NEVER substitute for each other. If tutor_payout wasn't
  loaded, the payout row is NOT rendered — absent data renders as absent, never
  as the other field (the `tutor_payout ?? student_price` fallback showed
  'payout = student payment' to admins for weeks while the data was intact).
- WALLET: any credit into student_wallet_transactions AUTO-SETTLES the pair's
  unpaid lessons (trg_wallet_settle_after_credit). Prepayments never sit idle.
- RATES: saving a tutor's rate ALWAYS backfills their existing unpaid hub
  lessons (backfill_tutor_payouts_for_tutor) — both PeoplePage AND Assign flows.
- MANUAL PAID: marking a lesson paid by hand NEVER bypasses the wallet — if the
  pair holds prepaid credit and the lesson has no wallet history, the credit is
  charged automatically (trg_wallet_charge_on_manual_paid). Phantom balances
  (paid lessons + untouched credit) are structurally impossible.
- SUBJECTS are canonicalized AT WRITE TIME (trg_subject_canon on lessons,
  student_rates, tutor_subject_rates + subject_canon registry): casing/spacing
  variants of the same subject cannot exist, so string-matched pricing never
  misses on formatting. Distinct wordings remain distinct subjects by design.
- FORMS GENERATION MAP (CORRECTED 20.08 — the earlier 58px-marker heuristic
  misclassified two NEW forms as old): NEW = QuickLessonDialog(3 variants),
  LessonDetailsDialog, OnboardingFlowB, RecordPaymentSheet, QuickAddStudent-
  Dialog. Remaining OLD on daily paths: People add-sheets (manager),
  MyStudents create/edit dialog (independent) — next commit; then student
  booking branch, group-create, SLA/TCRC wrappers, Wallet, Availability.
- OLD MAP (superseded): NEW 58px style = QuickLessonDialog
  (3 variants) + LessonDetailsDialog + OnboardingFlowB; EVERYTHING ELSE is old
  gen. Redesign waves in docs/UI-MERGE-PLAN.md; wave 2 = RecordPaymentSheet
  (FIRST commit of next session, fresh context — money form is never restyled
  at the tail of a long session).
- UI CANON — ONE component per concept (tripwires №8-№11): date/time =
  DateTimeField/DateField/TimeField; lesson create = Schedule inline (багата
  все-рольова) + QuickLessonDialog (швидка + групи) + OnboardingFlowB (перший
  урок) + lib/groupLessons — злиття QLD→LessonCreateDialog за
  docs/UI-MERGE-PLAN.md одразу після Publish-смоуку власниці; lesson view/edit
  = LessonDetailsDialog; payment = RecordPaymentSheet; student create =
  QuickAddStudentDialog (tutor) + People form (manager; StudentUpsertDialog =
  етап 2 плану); subjects = SubjectSelect/SubjectMultiSelect; lesson status =
  lib/lessonActions only; NotificationBell = AppLayout only. Нові поверхні
  ЗОБОВʼЯЗАНІ реюзати канон — паралельна копія = помилка збірки.
- LOCKFILE is COMMITTED IN SYNC on public npmjs URLs (root cause of the
  months-red CI: Lovable adds @lovable.dev/* to package.json without touching
  the lock → strict `npm ci` dies with EUSAGE everywhere). The old
  'checkout package-lock before commit' rule is RETIRED; after Lovable bumps
  package.json, re-sync the lock (`npm install`) and commit it.
- GATE CHAIN (usage order, all exit-coded): `npx playwright test --list`
  whenever playwright.config or tests/e2e change (config parse-gate; tsc does
  NOT cover that file — a broken ternary there muted the robot twice) → tsc → eslint src --quiet (CI
  demands ZERO errors — was invisible while CI install was broken) → vitest →
  check-i18n → check-ux → vite build.
- GATES check EXIT CODES, never grep-presence (`cmd; [ $? -eq 0 ]`): три
  червоні пуші сталися, бо пайпи ковтали фейли.
- FS-GHOST: пісочниця інколи губить записи файлів — після КОЖНОГО write
  перечитувати файл і звіряти маркер перед батареєю/комітом.
- DEBT DEFINITION is SINGLE: isStudentDebtLesson / isPayoutDueLesson in
  src/lib/financials.ts. Every channel (Finances card, debts tab, telegram
  digest, any future report) MIRRORS them verbatim. Debt is PERIOD-LESS —
  month filters shape turnover views, never receivables.
- PROCESS (переписано 03.09): DB fixes reach prod ONLY via the owner pasting
  SQL into Lovable chat. Стан бази для БУДЬ-ЯКОГО агента — `docs/PROD-DB-SYNC.md`
  + `node scripts/check-db-sync.mjs` (водяний знак = останній хеш-файл Lovable;
  `LIVE-MARKER` звіряється з `types.ts`, живим дзеркалом схеми). Кожна нова
  міграція: таймстемп вище водяного знаку, ідемпотентна, з `LIVE-MARKER`,
  рядок у журналі. SQL власниці — у чат цілком, ніколи «скопіюй з репо».
  «Done» лише після `✅ live` у скрипті. (Старий `outputs/PROD-DB-SYNC.sql`
  ніколи не існував у репо — рядок був фантомом.)
- Money math lives in pure libs (src/lib/financials*, src/lib/hubPricing.ts)
  and is locked by tests (financials.test.ts, lesson-financials-matrix.test.ts,
  hub-pricing-invariants.test.ts — includes a SOURCE tripwire against the
  prefill pattern). Tests green = release gate; changing money logic requires
  updating the business model here first, consciously.

### SECURITY INVARIANTS — student data surface
- Students must NEVER see fireflies_* columns (raw AI output). Student-facing
  views/queries expose only the curated `summary` the tutor copied. No fallback
  from summary to fireflies_summary — absent data renders as absent (guarded by
  src/test/security-invariants.test.ts).

### Theme & colors — INVIOLABLE (added 01.08 after repeated dark-theme bugs)
- NEVER hardcode text/background hex in components. Use theme tokens:
  text-foreground / text-muted-foreground / bg-card / bg-secondary /
  border-border / bg-primary+text-primary-foreground, or hsl(var(--token)) in CSS.
- Raw hex is allowed ONLY for brand art (gradients, icons) and MUST come with an
  explicit dark: variant when it colors text.
- Before every commit that touches UI, reason for BOTH themes: for each text
  node ask "what is its background in light? in dark?" Token pairs make the
  answer automatic; hardcoded hex is how we got white-on-white and
  dark-on-dark bugs three times.

### Protect (уточнено 03.09 рішенням власниці: нульова толерантність до помилок)
- `LessonCard.tsx` — його ДИЗАЙН і поведінка недоторкані (used across
  Dashboard/Schedule). Виправлення дефектів, знайдених аудитом (мертвий код,
  несправні фолбеки, a11y), дозволені, якщо рендер лишається побайтово тим самим.
- Supabase queries and hooks — не переписувати «бо так краще». Але якщо аудит
  показав дефект (наприклад, хук ковтає помилку і показує «0» замість збою) —
  виправляти. Аудит переважає над цим списком.
- Routing — не міняти маршрути без рішення власниці.
- i18n keys (only add, never rename).

---

## Design System

### CSS variables (src/index.css)
```css
:root {
  --teal: #2BBFAA;
  --teal-d: #25a896;
  --teal-l: #f0fdf9;
  --dark: #0f0f1a;
  --dark-m: #1a1a2e;
  --bg: #F5F4F0;
  --surface: #ffffff;
  --txt: #0f0f1a;
  --sub: #9398b0;
  --muted: #b0b4c8;
  --border: #f0f1f5;
}
```

### Typography
- Page h1: `text-[22px] font-extrabold` (mobile), `sm:text-2xl`
- Section labels: `text-[13px] font-bold uppercase tracking-[0.08em]` color `var(--sub)` (13px is the FLOOR — see below)
- Body: `text-[14px]–text-[15px]`
- Inputs: `text-[15px]` — prevents iOS auto-zoom (critical)

> **🔒 INVARIANT — Accessibility: minimum font size 13px (binding ТЗ, has regressed repeatedly):**
> The owner's users have ~80% vision and often use the app **outdoors in sunlight**. **NO readable text may be below 13px** — this applies to BOTH Tailwind `text-[Npx]` classes AND inline `style={{ fontSize: N }}` (most of this app sizes text inline, which is how tiny fonts kept creeping back). Never "compact" a layout by shrinking text below 13px. Enforced as a **hard error** by `scripts/check-ux.mjs` (rule "font < 13px") — the build fails on any sub-13 font, inline or class. When in doubt, go bigger, not smaller.
> ⚠️ **`text-xs` = 12px = VIOLATION** (use `text-[13px]`+). check-ux used to scan ONLY `text-[Npx]` + inline `fontSize`, so named classes like `text-xs` slipped through "green" gates repeatedly (the recurring regression). The gate now flags `text-xs` too (2026-06-19), but a passing gate is NOT proof — grep your changed files for `text-xs` yourself. `text-sm`=14px is OK.

### Inputs (base component already updated)
- `rounded-xl border-[0.5px] border-input h-11 text-[15px]`
- Focus: `border-[#2BBFAA] ring-[#2BBFAA]`
- Labels: `text-sm font-medium`

### Buttons
- Primary: `h-11 rounded-[12px] bg-[var(--teal)] text-white font-semibold`
- Submit (full-width in forms): `h-[50px] w-full rounded-[14px] text-[16px] font-semibold`
- Minimum touch target: **44px** (h-11) everywhere — no h-9 on interactive elements
- Exception: compact inline controls (view toggles, payment status selects in card footer) can be smaller

### Cards
- Border radius: `rounded-[16px]` — never `rounded-lg`
- Border: `border-[0.5px] border-[var(--border)]`
- Background: `bg-white`
- Stat cards: `rounded-[16px]`
- Profit dark card: `background: linear-gradient(135deg, #0f0f1a, #1a1a3e)`, `border-radius: 18px`

### Forms
- Always **bottom sheet** on mobile: `rounded-t-[20px] rounded-b-none sm:rounded-[20px]`
- On desktop: `sm:top-[50%] sm:translate-y-[-50%]`
- Progressive disclosure (contacts hidden by default, toggle to show)
- Drag handle at top of sheet: `h-1 w-9 rounded-full bg-border mx-auto mt-2.5`

---

## Layout — every page

### Header (top of every page)
```
[Page Title h1]          [🔔 Bell] [☰ Burger]
```
- Bell: `NotificationBell` component (golden radial-gradient, h-11 w-11 rounded-full)
- Burger: AppSidebar toggle — `fixed top-4 right-4 z-50 h-11 w-11 rounded-[14px] bg-[var(--teal)]`
  Opens sidebar nav. Does NOT navigate to /profile.

### FAB (+)
- `PageFAB` component on every page
- `fixed bottom-[78px] right-4 z-50 h-[52px] w-[52px] rounded-full bg-[var(--teal)]`
- Every page has ONE primary action via FAB — no duplicate header buttons
- Schedule: create lesson | People: add person | Groups: new group
- Chats: new chat (manager only) | Finances: record payment | Dashboard: quick actions

### AppSidebar
- Desktop: collapsible `w-64` ↔ `w-[68px]` via ChevronLeft/Right toggle at bottom
- Nav icons: each in `h-9 w-9 rounded-[10px] bg-rgba(255,255,255,0.06)` volumetric box
- Active item: `bg-[#2BBFAA22]` + icon `color: var(--teal)`
- Mobile burger: `fixed top-4 right-4` (NOT bottom-40)

---

## Pages

### DashboardPage
**Mobile layout (top → bottom):**
1. Hero: `linear-gradient(135deg, #0f0f1a, #1a1a3e)` — greeting + bell + (no burger)
2. Profit dark card + stat cards (the "bubbles") (mobile only — lg hides it, lg shows 4-col grid)
3. **TutorNotesCard — see the INVARIANT below**
4. NeedsMarkingCard
5. SmartTasks (colored left borders: warn=#f59e0b, info=#3b82f6, muted=#d0d3e0)
   - One action button max per task + arrow › on right — NO "Переглянути" duplicate
6. Today's lessons — `LessonCard` unchanged (same as SchedulePage)
7. FAB

> **🔒 INVARIANT — TutorNotesCard position (binding ТЗ, has regressed twice):**
> The notes card renders **directly under that role's stat "bubbles" (profit card + metric/stat cards), ALWAYS, and NOWHERE else.** It must NOT drift below NeedsMarkingCard, pending-payments, or the lessons list. There are exactly **three** gated renders in `DashboardPage.tsx`, each immediately after that role's bubbles:
> - **Independent tutor** — after the independent profit/stat grid (`{isIndependentTutor && …}`).
> - **Manager** — immediately after the manager profit+stat grid, BEFORE NeedsMarkingCard / pending payments (`{isManager && …}`).
> - **Hub tutor** — INSIDE the hub block, immediately after the payout card + the two stat tiles, BEFORE the «Pro активний» chip.
> Never collapse these into one render placed after the marking/payments sections — that is the regression. Verify all three roles after any DashboardPage edit.

**Desktop (lg):**
- 4 metrics in ONE row: Profit (dark) + Tutors + Students + Lessons today
- Two-column layout: left=lessons (60%), right=tasks (40%)
- Hero: no dark background (transparent on lg), text adapts to dark foreground

**Manager pending payments section:**
- Shows LessonCard list with full extraActions + footer (same as SchedulePage)
- Empty state: `☀️ Так тримати! Усі уроки оплачені — все під контролем 🎉`

**Role guards:**
- `loadData()` blocked until `authLoading=false` AND `roles.length > 0`
- New users with no roles see empty state, not other orgs' data

### PeoplePage
**Header:** h1 + bell + teal burger (44px, 14px radius)

**Tabs:** Репетитор N / Учень N / Менеджер N
- Active: `border-bottom 2px var(--teal)`, color teal, font-weight 600

**Status pills** (horizontal scroll):
`Всі` / `✅ Активні` / `⚠️ Борг` / `⏳ Очікують реєстрації` / `📦 В архіві`
- Active: `bg-[#E1F5EE] border-teal color-[#0F6E56]`

**Card (collapsed):**
- Avatar 46px + color status dot (bottom-right 12px):
  green=active / red=debt / gray=archived / yellow=pending
- Name 15px/600
- Subject · rate (NOT email) for tutors/students; email only for pending
- Chat circle button 30px right side

**Tap on card → bottom sheet:**
- Drag handle
- Header: avatar 52px + name + role | [🗄 archive][🗑 delete][✏️ edit][✕ close]
  Archive/delete small icons (subtle). **✏️ edit (`openEditFor`) opens the ONE
  canonical `PersonEditSheet` for EVERY role** (the SF_A «Один потік» form: avatar +
  name, role section, contacts, 🔒 manager note). Binding ТЗ (PEOPLE-HANDOFF: ✏️ →
  форма). **🔒 INVARIANT: never reintroduce a separate per-role edit dialog** (the old
  `ContactEditDialog`/`StudentEditSheet` split was the divergence the owner flagged —
  both retired from People). Role section inside `PersonEditSheet`:
  student → read-only gold per-tutor rates summary (rates stay per-tutor, edited in
  the rate rows / RatePropagation — one price field would misrepresent the hub's
  multi-tutor model); tutor → editable subjects + payout (bank/card); manager →
  identity + contacts only.
- Phone row + copy icon
- Email row + copy icon
- Subject · rate row + pencil (opens RatePropagationDialog)
- Onboarding progress bar "X з 9 кроків" (tutors, manager view)
- Manager private notes
- **Student actions**: [Репетитор] [Гаманець] [Ставка] — 3-col grid teal/gray
- **Pending**: [Нагадати (teal)] [Видалити (red)] — NOT "Запросити"

**All forms as bottom sheet:**
- `PersonEditSheet`: SF_A bottom sheet — the single ✏️ edit form for ALL roles on People (manager)
- `ContactEditDialog`: retired from People; remains ONLY for self-profile contacts on `ProfilePage` (editing your own profile ≠ a manager editing a person, so it keeps its own contacts editor)
- `InviteLinkDialog`: bottom sheet, teal send button
- `RatePropagationDialog`: bottom sheet, teal confirm
- `WalletDialog`: already bottom sheet, teal submit

### SchedulePage
- Bell + burger in header (right side of existing filters row)
- "Створити урок" header button removed — FAB handles it
- LessonCard unchanged (source of truth for lesson card design)

### FinancesPage
- Tabs: underline style `border-b-2 border-[#2BBFAA]` active, `bg-transparent`
- "Записати оплату" header button removed — FAB handles it

### GroupsPage, ChatsPage
- Bell + burger in header (right side)
- Create buttons removed from header — FAB handles them (incl. Chats new-chat:
  mobile = bottom-right PageFAB on the list view; desktop = list-header button)
- Skeleton loading (not Loader2 spinner)

### Group lessons & billing (multi-phase, in progress 2026-06-18)
**Pricing model (owner decision): each student in a group has their OWN price** for
group lessons ("своя ціна для кожного учня в групі"). Data model:
- `group_enrollments.price_per_lesson` (+ currency) = the configured per-student
  group rate (analogous to `student_rates` for individual).
- `lesson_participants.student_price` / `student_payment_status` / `student_paid_at`
  = per-(group lesson, student) SNAPSHOT + payment status
  (analogous to `lesson_details` for individual, but ONE ROW PER PARTICIPANT, since a
  group lesson has `lessons.student_id = NULL` and links students via
  `lesson_participants`).
- Foundation migration: `20260618160000_group_lesson_billing.sql` — **must be applied
  via Lovable**. RLS unchanged (tutor-of-group + manager already FOR ALL; student
  SELECTs own). ⚠️ **NEVER put tutor_payout / hub-margin on group_enrollments or
  lesson_participants** — students can SELECT their own rows there, so any payout
  column leaks the hub margin (caused a critical; removed in 20260618170000). Hub
  group payout must live on a manager/service-role-only surface.

### Security: tutor_workspace_settings is privilege-escalation-sensitive
The 7 columns independent_workspace / subscription_status / subscription_until /
current_plan / liqpay_recurring_active / liqpay_card_token / **trial_until** must be
unwritable by tutors (else they self-promote / self-extend trials). Protected by BOTH
a BEFORE UPDATE trigger (`guard_tutor_workspace_settings_update`) AND a column-level
GRANT lock (latest: `20260618170001`). Legitimate writes go via SECURITY DEFINER RPCs
(`grant_pro_days` — sets `app.allow_grant_pro_days`; `set_own_independent_workspace`)
or the service-role LiqPay callback. NEVER add trial_until/subscription cols back to
the tutor GRANT or drop them from the guard. (Lovable's apply pipeline once mangled a
lock migration's newlines into an inert comment — after asking Lovable to apply a
security migration, VERIFY it actually took via the Security panel re-scan.)
**Status 2026-06-18: group findings #1/#2 RESOLVED + confirmed LIVE.**
Lovable re-applied 170000+170001 cleanly as `20260618171843…` (real newlines this time):
trigger blocks all 7 cols, `REVOKE UPDATE … GRANT UPDATE (safe cols only)` excludes all
7. Verified live via types.ts: `group_enrollments`/`lesson_participants` no longer have
any `tutor_payout*` column; students SELECT only their own row on both group tables, so
no price/margin leak. Residual accepted note: `lesson_details_student` "Security Definer
View" — documented exception.

**Status 2026-06-19: workspace self-grant criticals — write path re-architected
(`20260618190000`).** The scanner is POLICY-based: it kept flagging the trigger+GRANT
approach because the tutor still had a row-level UPDATE *policy* on a table containing
the 7 cols. Fix: **dropped ALL tutor INSERT/UPDATE policies** on tutor_workspace_settings;
tutors now write safe settings ONLY through SECURITY DEFINER RPC
`update_my_workspace_settings(_patch jsonb)` (strips the 7 privileged keys, applies a
fixed safe-column whitelist via jsonb_populate_record). Tutors keep SELECT-own; the
columns did NOT move, so reads / billing webhooks / grant_pro_days / expiry cron are
untouched. The trigger + GRANT lock stay as defense-in-depth. **INVARIANT: never re-add a
tutor INSERT/UPDATE policy on tutor_workspace_settings — all tutor writes go via the RPC.
All 3 frontend writers (useWorkspaceSettings, AutoCompletePromptDialog,
AutoCompleteLessonsCard) call the RPC, not `.upsert`.** Same migration reset every
non-active tutor to a fresh 30-day trial (they registered during development, never used
it). Two other scanner items fixed alongside: dropped orphan `student_details.tutor_notes`
(`20260618180000`); RevenueCat webhook now filters `tutor_id` not `user_id`.

**Status 2026-06-19 (round 2): remaining findings (`20260619000000`).** After the above,
the scanner still flagged trial self-extension + a realtime channel:
- **Trial:** `trial_until` is written only by `grant_pro_days()` (adds N days/call). It's
  reachable ONLY via the SECURITY DEFINER referral/streak flows (run as owner), managers,
  service role — NO frontend/edge calls it. Re-asserted `REVOKE EXECUTE … FROM PUBLIC,
  anon, authenticated` on it + re-asserted the column UPDATE lock (trial_until + 6
  billing cols never directly writable). **INVARIANT: grant_pro_days must NOT be
  EXECUTE-grantable to authenticated — it's an unbounded trial/Pro granter.**
- **Realtime:** the `lesson-details:<id>` broadcast topic is UNUSED anywhere in the app
  (no sender/subscriber) but its policy let students subscribe to a channel that could
  carry tutor_payout/Fireflies. Restricted "Lesson details realtime" policy to the
  lesson's tutor + managers only.
- RevenueCat `tutor_id` fix was redeployed by Lovable ("Applied 2 migrations &
  redeployed", `20260619071130`); clears on rescan.

**Status 2026-06-19 (round 3): the trial fix didn't apply — MIGRATION ORDERING TRAP
(`20260620000000`).** Multi-agent audit found `20260619000000` has a timestamp BELOW the
already-applied Lovable hash `20260619071130`, so Supabase's runner **silently skipped
it** (it runs only versions > the recorded high-water mark). So the trial column-lock /
grant_pro_days revoke / realtime fix never applied via the normal path, and the live
column GRANT still exposed `trial_until` (the scanner reads LIVE DB state — proven by the
RevenueCat finding reading the deployed fn). Migrations `20260618150000`/`150457` had
`trial_until` INSIDE their GRANT-back block = the live source. Fix re-issued as
`20260620000000` (timestamp > `071130`, guaranteed to run): explicit
`REVOKE UPDATE(trial_until + 6 billing cols) FROM authenticated, anon, PUBLIC` + safe-col
GRANT + grant_pro_days EXECUTE revoke + realtime restriction. Adversarially verified (3
reviewers PASS). **INVARIANT: every new migration must be timestamped strictly ABOVE the
latest applied (incl. Lovable hash files) or it is silently skipped.** RevenueCat: code is
correct (`tutor_id`); only needs the function redeployed.

**Phases (ALL DONE 2026-06-18):** ✅(1) per-student price on enrollment + invite
unregistered students on enroll (InviteLinkDialog) · ✅(2) schedule group lessons from
manager/hub + independent via `createGroupLesson()` (src/lib/groupLessons.ts) writing
per-participant price + notifying each participant · ✅(3) students SEE group lessons
(StudentSchedulePage/Dashboard via `studentLessonsOrFilter`; StudentPaymentsPage via
direct `lesson_participants` read) + notify on create AND cancel/delete
(`notifyGroupLessonCancelled`, wired into Dashboard/Schedule status→cancelled + every
delete site) · ✅(4a) per-participant payment marking (`GroupLessonParticipants` in
`LessonDetailsDialog` for group lessons) · ✅(4b) group money on all surfaces:
StudentPaymentsPage + dashboard pending-count include group participations; FinancesPage
flattens each participant into its own income row (payment writes route to
`lesson_participants`, payout/profit show "—" since no group payout is tracked) + a
"group" tag. Group lessons also get an honest `groupLessons.cardLabel` on tutor/manager
cards (student_id is NULL).
**Invariants:**
- Anything reading group lessons goes through `lesson_participants` (NOT
  `lessons.student_id`, which is NULL for groups).
- ⚠️ `lesson_details_student` handles group *visibility of homework/summary*, but its
  price/payment columns come from `lesson_details`, which has NO row for group lessons —
  so for per-student group PRICE/PAYMENT you MUST read `lesson_participants` directly
  (createGroupLesson writes no lesson_details row). Do not "reuse the view" for money.
- A group lesson has no shared `lesson_details` row → quick-pay toggles on
  Schedule/Dashboard are guarded to no-op for groups (mark per-participant in the dialog).

### Student pages (`/pages/student/`)
- All empty states use positive framing (see below)
- Consistent with main design system

### MyStudentsPage (independent tutor)
- Bell in header
- FAB → add student

---

## Empty States — MANDATORY positive framing
**Rule: ZERO "Немає X" patterns. Always warm and positive.**

| Key | Value (uk) |
|-----|-----------|
| noUpcoming | ☀️ Вільний час — насолоджуйся! |
| noLessons | Поки тихо. Час запланувати урок 📅 |
| noDebts | 🎉 Чисто! Всі оплатили. |
| noDebtsDesc | Жодних заборгованостей — так тримати! 💪 |
| noData | Ще немає даних — зʼявляться після першого уроку ✨ |
| noStudents | Час познайомитись з першим учнем! Додайте його — і вперед 🚀 |
| noLessonsTitle | Перший урок ще попереду ✨ |
| notifications.empty | Все під контролем! 🎉 |
| notifications.emptyDesc | Жодних сповіщень — можна спокійно дихати. |
| dashboard.allPaidTitle | Так тримати! |
| dashboard.allPaidDesc | Усі уроки оплачені — все під контролем 🎉 |

---

## Skeleton Loading
- `PageSkeletons.tsx`: `DashboardSkeleton`, `ScheduleSkeleton`, `FinancesSkeleton`, `StudentsSkeleton`, `PeopleSkeleton`, `GroupsSkeleton`, `ChatsSkeleton`
- Replace ALL `Loader2 animate-spin` full-page spinners with skeletons
- Inline spinners (form submit, send button) stay as Loader2

---

## UX Polish
- `useHaptic` hook: `tap(10ms)` / `success([15,50,30])` / `error([50,30,50])` — applied to
  lesson-complete, FinancesPage mark/bulk-paid, CloseDayDialog batch-close, RecordPaymentSheet,
  homework-done, NeedsMarkingCard. Wire it into every new "win"/"task done"/"error" tap.
> **🔒 INVARIANT — Marking a payment must give INSTANT feedback (binding ТЗ, regressed):**
> Any "mark paid / received" action MUST update the UI OPTIMISTICALLY first (so the tap is
> seen instantly), fire `haptic.success()`, and show a confirmation toast — THEN await the
> DB and revert on error. NEVER `await` the DB write before the visual change: that gives a
> dead ~1–2s hang, then a confusing blink as the card flips + drops out of a filtered list,
> leaving the owner unsure whether anything happened. Canonical good pattern:
> `FinancesPage.togglePayment` (optimistic → haptic → warm "💰 …" toast → await → revert).
> `DashboardPage.updatePayment` regressed to await-first (fixed 2026-06-19). Re-check this
> on every payments/finances/dashboard edit. See memory
> requirements-remember-and-recheck-every-iteration.
- `usePullToRefresh` — Dashboard renders a real indicator driven by `pullProgress`
  (`pullToRefresh.pull` / `.release`), not just the bare reload.
- `burstConfetti` lives in `src/lib/confetti.ts` (reuses the `confetti-pop` keyframe). Use it
  for every celebration — do NOT re-copy the inline version. `joinPulse` keyframe is in index.css.
- Celebrations: per-lesson complete (confetti+haptic+toast, first-ever lesson gets an escalated
  one-time milestone), FinancesPage bulk debt-clear (confetti), DayClosedCelebration + CloseDay
  batch-close (haptic+confetti).
- `OfflineBanner` — fixed top, dark bg, auto-hides 3s after restore — in AppLayout (all pages)

### Student core actions (loud + time-aware)
- Join: labeled «Приєднатися» on Student dashboard **and** schedule; goes glowing
  «Приєднатися зараз» (`joinPulse`) from 15 min before start through lesson end, with a
  «через X хв» / «йде зараз» status; never-empty «Посилання зʼявиться перед уроком» fallback.
- Homework: per-card «Позначити виконаним» completion toggle. Local per-device checklist in
  `src/lib/homeworkDone.ts` (students read the read-only `lesson_details_student` view, so there's
  no server flag). Marking done celebrates; dashboard homework count subtracts done items.

### Student first-value path (do not regress)
- A self-signup student's tutor request lives in `tutor_referral_requests` (RLS lets a
  student insert their own; managers see all on `/referrals` + the Dashboard smart-task;
  `AssignTutorDialog` fulfils it → writes `student_rates` source='hub' → `hasTutor` flips).
- The in-app request path is `FindTutorDialog` (writes `tutor_referral_requests`). It is the
  student dashboard's no-tutor CTA (empty state + Block 6). The onboarding quiz
  (`StudentOnboarding`) ALSO creates a request on submit — that's why its "manager received
  your request" copy is honest. Don't revert these to the old quiz-relaunch button.
- Managers are notified via `notify_managers(_type,_title,_body,_link)` (SECURITY DEFINER) —
  a student can't read `user_roles` to enumerate managers under RLS, so the fan-out MUST go
  through that RPC, not a client-side `user_roles` query (which silently returns nothing for
  non-managers). Call it best-effort via `notifyManagers()` in `src/lib/notifications.ts`.

### Role-aware dashboard FAB & onboarding (do not regress)
- The Dashboard `AddFab` is role-aware: managers route to the canonical `/schedule?create=1`,
  `/people?add=student`, `/finances`. Never point a manager at QuickLessonDialog/
  QuickAddStudentDialog — those query only the tutor's own `source:'independent'` rows.
- `tutor_details` is keyed on `user_id` (there is NO `tutor_id` column) — never write/read `tutor_id`.
- Onboarding is `OnboardingFlowB` (route `/onboarding`). `OnboardingContent`/`OnboardingDialog`
  are retired (banner + sidebar both navigate to `/onboarding`).

---

## Notifications (NotificationBell)
- Always golden: `radial-gradient(circle at 35% 30%, #ffd04a, #f59e0b 60%, #d97706)`
- `h-11 w-11 rounded-full`
- Same style on EVERY page — no plain/gray variant

---

## Referral Flow
- Bonus: **21-day Pro trial** for the referred friend + **1 month Pro** for the referrer (per friend who subscribes)
- JoinPage: dark hero gradient + teal CTA button — matches app design
- No `?role=tutor` forced in signup URL
- Share text: uses `referralWidget.shareText` i18n key (not hardcoded Ukrainian)
- Claim logic: fires on SIGNED_IN, reads from localStorage, removes after claim

---

## i18n Rules
- 3 locales: `uk.ts` (primary), `en.ts`, `sv.ts`
- All 3 must be in sync — `check-i18n.mjs` validates
- Never use hardcoded UI strings — always i18n keys
- After adding keys: verify count matches across all 3 locales

---

## Monetization & Business Model — READ FIRST (do not re-ask the owner)

There are **two separate revenue models** depending on tutor type. Conflating them
causes critical errors. Both are already implemented — verify against the code
fields below before building anything money-related.

### Hub tutors (school with a manager)
- The hub has its own tutors. **Students pay the HUB; the hub pays the tutor.**
- Prices are **fixed per pair** (student × tutor × subject) in `student_rates.price_per_lesson`.
- Per lesson, `lesson_details` holds BOTH sides:
  - `student_price` — what the student owes the hub (+ `student_payment_status`, `student_paid_at`)
  - `tutor_payout` — what the hub owes the tutor (+ `tutor_payout_status`, `tutor_paid_at`)
- **Hub margin = `student_price − tutor_payout`** per lesson. The manager Finances
  page already computes this: `totalIncome = Σ student_price`,
  `totalExpense = Σ paid tutor_payout`, `profit = income − expense`
  (see `FinancesPage.tsx` ~lines 509–519).
- The hub tutor does NOT pay a subscription — they receive payouts FROM the hub.
  `PayoutScheduleCard` (manager side, in the tutor dialog on People) sets WHEN the
  manager pays the tutor (weekly / biweekly / monthly via
  `payout_frequency/weekday/monthday`).
- So: revenue for the hub comes from the **per-lesson margin**, not a subscription.

### Independent tutors
- Manage their OWN students, set their OWN prices, collect payments **directly**
  (no hub in the middle, no `tutor_payout` margin to a hub).
- Monetization here is the **subscription**: unlimited students on Free; Pro is **249 ₴/mo**
  (owner decision 2026-07-01). The old "5 students free, then 145 ₴/mo" model was retired —
  there is NO student-count paywall in code (`useWorkspaceSettings` keeps the counter for
  stats only). `SubscriptionPage.PRO_PRICE_MONTHLY = 249` is the source of truth for price.
- This is the only place the "Pro / subscription / trial" concepts apply.
- **Organic trial EXISTS (don't re-conclude it doesn't):** `handle_new_user` (live body =
  `20260521180319`) bootstraps every new TUTOR's workspace row with
  `subscription_status='trial', trial_until = now() + 30 days` — the landing's «30 днів
  безкоштовно» is true. The CHECK constraint allows 'trial' since `20260424125121`.
  A referred friend gets **+21 days on top** via claim_referral → grant_pro_days
  (extends trial_until), i.e. ~51 days total. AuthPage passes
  `independent_workspace: role === "tutor"` in signup metadata.

> **🔒 INVARIANT — DEBT model (owner decision 2026-09-04; REPLACES the 06.07
> «prepayment debt» rule — do not resurrect it from old docs/commits):**
> - **Student debt** = **CONDUCTED and unpaid only**: `status='completed'`,
>   price > 0, unpaid (cancelled only with `is_cancellation_fee`). Predicate:
>   `isStudentDebtLesson` in `src/lib/financials.ts`. FUTURE scheduled unpaid
>   lessons are NOT debt — they are **expected payments**
>   (`isExpectedPaymentLesson`), shown as a forecast figure, NEVER summed with
>   debt. Both hub DB functions mirror this (migration `20260904100000`).
> - **Tutor payout due** = **CONDUCTED lessons only** (completed or already started),
>   payout > 0, never group rows. Predicate: `isPayoutDueLesson` — it must mirror the
>   `mark_tutor_payouts_paid` RPC EXACTLY, so the shown sum always equals what the pay
>   button flips. NEVER compute payout-due with `isBillableLesson` (its student-prepaid
>   shortcut admits future lessons → "виплачено, але уроки висять" bug).
> Locked by financials.test.ts. Every channel (Finances, dashboard reminders,
> People «⚠️ Борг», telegram digest, CSV) mirrors these predicates verbatim.

### Don't mix them
- "Pro / subscription / 249 ₴/mo / trial" → **independent tutors only**.
- "student_price vs tutor_payout / margin / payout schedule" → **hub only**.
- A hub tutor screen must show hub payouts (what the hub owes them), NOT a
  subscription. An independent tutor screen must never show `tutor_payout`/margin.

- Referral: 21-day trial (friend) + 1 month Pro (referrer) — independent side.
- Payments are **implemented**: LiqPay on web (`liqpay-create-payment`/`liqpay-callback`),
  RevenueCat store-billing (IAP) on native via `src/lib/iap.ts`. On **native** builds
  (iOS+Android) the SubscriptionPage shows the IAP card only (LiqPay hidden) — store policy
  (Apple 3.1.1 / Play) forbids external payment for digital subscriptions.
- `TrialCountdownBanner`: only shows if `trial_until` was set AND expired. (Note: since
  `20260521180319` every new tutor HAS `trial_until` set at signup — the old "new
  registrations have trial_until=null" premise is obsolete.)

---

## Known Pending Work (DONE items removed — were stale)
Already implemented (do NOT re-build): LiqPay + RevenueCat IAP scaffolding, onboarding
(3 steps + confetti), weekly/daily digest functions, dynamic SPOTS_LEFT, account deletion,
TrialCountdownBanner.

**UX backlog:** the full deep UX/flow audit lives in `docs/UX-AUDIT.md` (79 findings).
The 4 highest-leverage packages (manager FAB/onboarding/chats bugs, loud student actions,
hub-tutor + manager accents, delight propagation) are DONE — see the remediation tracker at the
top of that file. The remaining MED/DELIGHT items there are the next UX backlog.

**Real remaining work = release/ops, mostly owner-side (see docs/RELEASE-GUIDE.md):**
- iOS native project not yet created (`npx cap add ios` on a Mac) — App Store blocker.
- Store-billing config (owner): RevenueCat keys (`VITE_REVENUECAT_IOS_KEY`/`_ANDROID_KEY`),
  App Store Connect + Play products, deploy `revenuecat-webhook`.
- Android signing keystore; store screenshots; demo/review account; privacy/support URLs.
- Apply digest migrations (`telegram_*_digest` cols + cron not yet live).
- Apply `20260618130000_notify_managers_rpc.sql` (manager bell-ping when a student requests a
  tutor). Depends on `create_notification` (should already be live — notifications work app-wide).
  Until applied, requests still surface via `/referrals` + the dashboard task.
- Native push (`@capacitor/push-notifications` + APNs/FCM) — Web Push hidden on native for now.
- `uk.ts.new` cleanup.

---

## CI Checks (run after every commit) — усі за exit-кодом
```bash
npm run typecheck                 # НЕ npx tsc --noEmit (перевіряє нічого)
npx eslint src --quiet            # 0 errors (X1 previewAuthStorage — задокументований виняток)
npm run test                      # vitest, усі зелені
npm run build                     # vite build — обов'язковий
node scripts/check-i18n.mjs       # uk/en/sv синхронні
node scripts/check-ux.mjs         # 0 errors
node scripts/check-hardcode.mjs   # ≤ ліміту; бачить t("k") || "Укр" (03.09)
node scripts/check-currency.mjs   # 0 літеральних валют
node scripts/check-db-sync.mjs    # міграції нижче водяного знаку = 0
npx playwright test --list        # парс-гейт e2e
# edge: for f in <touched>; do npx esbuild supabase/functions/$f/index.ts --format=esm --outfile=/dev/null; done
```

## Process Rules
1. `git pull` before every edit session (Lovable may have published)
2. Never report done until Chrome extension confirms page works
3. After every push → check each changed page via Chrome extension
4. Fix runtime errors immediately — don't wait for user report
5. Missing imports (Menu, Link, X etc.) = crash — always verify imports after adding JSX

## Quality bar & no-regression (READ — the owner has flagged repeated sloppy/regressed work)
Do it RIGHT the first time. A task is not done until ALL of the below hold — verify
regressions with the SAME diligence as verifying changes reached prod:
1. **Build it to the binding ТЗ.** The approved design handoffs + the invariants in
   this file are the spec, not suggestions. If the code diverges from the design,
   fix the code to the design and adjust the flow — don't leave a half-match.
2. **Trace ALL interdependent logic, across every role.** A change to a shared
   component/flow (dashboard, People, groups, payments, notifications) must be
   checked for manager / hub-tutor / independent-tutor / student. Hub model:
   managers don't own `student_rates`; students link to hub tutors via
   `student_rates` source='hub'; logic written only for the independent-tutor case
   is the #1 source of these bugs (manager FAB, group student-picker, etc.).
3. **No regressions of documented invariants.** Before finishing a DashboardPage /
   People / layout edit, re-check the 🔒 invariants in this file (e.g. notes
   directly under the bubbles) for every role. Skim the diff for anything that moved
   a pinned element.
4. **Empty-state / message text must match the code's actual logic.** A placeholder
   that says something the query doesn't do (e.g. "all students already have tutors"
   on a list that filters by tutor) is a bug, not just copy.
5. **Run all gates green** (tsc 0 · vitest · check-i18n · check-ux · check-hardcode)
   AND eyeball the affected pages per role before reporting done.
