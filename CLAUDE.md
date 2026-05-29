# oTutorHub — Project Context for Claude

## Project
- **Repo**: `Oksana-Chopak/otutorhub-5`
- **Prod**: `otutorhub.com`
- **Stack**: React + TypeScript + Tailwind + shadcn/ui + Supabase + i18next
- **Supabase project**: `kficbcjqcbhqhjimxfed`
- **Code generator**: Lovable (publishes to `main` branch)
- **Roles**: manager / tutor (hub) / tutor (independent) / student

## Critical Rules

### Git workflow
- Lovable publishes to `main` after every Publish — always `git pull` before editing
- After every commit: `npx tsc --noEmit && npm run test && node scripts/check-i18n.mjs && node scripts/check-ux.mjs`
- Only push if ALL four checks are green
- After push — verify each changed page via Chrome extension before reporting done

### Never touch
- `LessonCard.tsx` — perfect as-is, used across Dashboard/Schedule
- Supabase queries and hooks logic
- Routing
- i18n keys (only add, never rename)

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
- Section labels: `text-[11px] font-bold uppercase tracking-[0.08em]` color `var(--sub)`
- Body: `text-[14px]–text-[15px]`
- Inputs: `text-[15px]` — prevents iOS auto-zoom (critical)

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
2. Profit dark card (mobile only — lg hides it, lg shows 4-col grid)
3. NeedsMarkingCard
4. SmartTasks (colored left borders: warn=#f59e0b, info=#3b82f6, muted=#d0d3e0)
   - One action button max per task + arrow › on right — NO "Переглянути" duplicate
5. Today's lessons — `LessonCard` unchanged (same as SchedulePage)
6. TutorNotesCard
7. FAB

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
  Archive/delete small icons (subtle), pencil=edit contacts
- Phone row + copy icon
- Email row + copy icon
- Subject · rate row + pencil (opens RatePropagationDialog)
- Onboarding progress bar "X з 9 кроків" (tutors, manager view)
- Manager private notes
- **Student actions**: [Репетитор] [Гаманець] [Ставка] — 3-col grid teal/gray
- **Pending**: [Нагадати (teal)] [Видалити (red)] — NOT "Запросити"

**All forms as bottom sheet:**
- `ContactEditDialog`: bottom sheet, teal submit
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
- Create buttons removed from header — FAB handles them
- Skeleton loading (not Loader2 spinner)

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
- `useHaptic` hook: `tap(10ms)` / `success([15,50,30])` / `error([50,30,50])` — applied to key actions
- `usePullToRefresh` — Dashboard: pull indicator "↓ Потягни / ↻ Відпусти"
- `OfflineBanner` — fixed top, dark bg, auto-hides 3s after restore — in AppLayout (all pages)

---

## Notifications (NotificationBell)
- Always golden: `radial-gradient(circle at 35% 30%, #ffd04a, #f59e0b 60%, #d97706)`
- `h-11 w-11 rounded-full`
- Same style on EVERY page — no plain/gray variant

---

## Referral Flow
- Bonus: **+30 days** for both referrer and referred (NOT +7)
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

## Monetization
- Monthly subscription after 30-day trial
- First cohort: free for 6 months
- Referral: 30 days Pro for both parties
- LiqPay integration: **pending** (not yet implemented)
- `TrialCountdownBanner`: only shows if `trial_until` was set AND expired
  (never shows for new registrations with `trial_until=null`)

---

## Known Pending Work
- **LiqPay** payment integration (critical before release)
- Onboarding flow for new manager/tutor (3 steps + confetti)
- "First lesson" celebration moment
- Weekly digest notification
- `uk.ts.new` cleanup
- Dynamic SPOTS_LEFT counter from DB
- Mobile app via Capacitor (iOS/Android)

---

## CI Checks (run after every commit)
```bash
npx tsc --noEmit          # 0 errors required
npm run test              # 118 tests must pass
node scripts/check-i18n.mjs  # all keys synced uk/en/sv
node scripts/check-ux.mjs    # 0 errors, <115 warnings
```

## Process Rules
1. `git pull` before every edit session (Lovable may have published)
2. Never report done until Chrome extension confirms page works
3. After every push → check each changed page via Chrome extension
4. Fix runtime errors immediately — don't wait for user report
5. Missing imports (Menu, Link, X etc.) = crash — always verify imports after adding JSX
