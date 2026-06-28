# Cross-Role Design-Consistency Audit — oTutorHub

**Date:** 2026-06-28
**Scope:** every role (manager / hub tutor / independent tutor / student) × every flow.
**Goal (owner's ask):** shared chrome (sidebar, notification bell, FAB `+`) and forms must be
**identical app-wide**; find every role that has a "frozen" old design, a crippled layout, or
a leftover rudiment form. Hub tutor checked first (most staleness).

**Method:** 3 parallel code audits + manual verification of every actionable finding.
Items marked ✓ were confirmed by reading the code directly (not just reported).

---

## TL;DR — status of the shared elements

| Element | Verdict | One-line |
|---|---|---|
| **Sidebar** | 🔴 DIVERGENT | Students use a *different* sidebar (light bg, smaller icons/font, no glow). Manager/tutors share `AppSidebar`. |
| **Notification bell** | 🔴 DIVERGENT | Students have **no bell at all**. Everyone else: identical golden `NotificationBell`. |
| **FAB `+`** | 🟠 PARTLY | Dashboard uses `AddFab` (58px, square-ish), every other page uses `PageFAB` (52px, round) → the `+` looks different on the dashboard vs other pages. Students have no FAB. |
| **Header / layout** | 🔴 DIVERGENT | Students use `StudentLayout` (h-14 header, lighter title, no bell, no burger). Everyone else: `AppLayout`. |
| **Forms (bottom-sheet)** | 🟢 CONSISTENT | All live forms are modern bottom-sheets. The check-ux gate holds. |
| **Date/time controls** | 🟡 OK-ish | No single shared component (3 ad-hoc approaches), but all pass the size/readability floor. |
| **Rudiment / dead forms** | 🟠 CLEANUP | 5 dead component files still in the tree (incl. `OnboardingContent`, which task #12 was supposed to delete). |
| **Hub-tutor dashboard FAB** | 🔴 BUG | `+` → "Урок"/"Учень" opens the *independent-only* dialogs → **empty student list** for a hub tutor. |
| **Hub-tutor onboarding** | 🟠 PARTIAL | Flow works & is reachable (first-login + Profile), but the **sidebar entry is hidden** for hub tutors. |

Headline: **forms are unified; the chrome (sidebar/bell/FAB/header) is NOT — the student role is on a
separate old shell, and the dashboard `+` differs from every other page.** That is exactly what you're
seeing as "different font on one role, different bell, different plus."

---

## PART A — Shared chrome (the core complaint)

### A1. Sidebar — 🔴 DIVERGENT ✓

Two separate implementations:

- **`AppSidebar.tsx`** (manager + both tutor types) — dark `var(--dark-m)`, collapsible `w-64 ↔ w-[68px]`,
  icon in a volumetric box `h-9 w-9 rounded-[10px]`, icon glyph `h-[18px]`, active = teal-gradient box +
  left accent bar + teal label. Nav row `rounded-[12px]`, label `text-base` (mobile) / `text-sm` (lg).
- **`student/StudentLayout.tsx`** (student) — light `bg-card`, **fixed `w-60` (not collapsible)**, **no icon
  box**, icon glyph `h-4 w-4` (smaller), active = solid `bg-primary` fill, nav row `rounded-lg`, label always
  `text-sm`. *(StudentLayout.tsx:37, 52, 54, 59)*

| Detail | AppSidebar (everyone else) | StudentLayout (student) |
|---|---|---|
| Background | dark `var(--dark-m)` | light `bg-card` |
| Icon box | `h-9 w-9 rounded-[10px]` | none |
| Icon size | `h-[18px]` | `h-4 w-4` |
| Row radius | `rounded-[12px]` | `rounded-lg` |
| Active state | teal box + accent bar + teal text | solid teal fill |
| Label font | `text-base` → `text-sm` | always `text-sm` |
| Collapsible | yes | no |

**This is the "different font / different look between roles" you reported.** The student sidebar is the old shell.

### A2. Notification bell — 🔴 students have none; prop no-op ✓

- `NotificationBell.tsx` is always golden (`radial-gradient`, `h-11 w-11 rounded-full`) — identical everywhere
  it's used. ✓ Good.
- **Students never see it.** `StudentLayout`'s header (StudentLayout.tsx:86–88) renders **only the `<h1>`** — no
  bell. So on every `/student/*` page there is no notification bell. ✓
- Minor: the `golden` prop on `NotificationBell` is accepted but unused (gradient hardcoded) — harmless dead prop.
- Edge case: `/chats` swaps to `StudentLayout` for pure students → a student on Chats also loses the bell.

### A3. FAB `+` — 🟠 two shapes + 1 hub bug ✓

| FAB | Size | Radius | z | bottom | Where |
|---|---|---|---|---|---|
| **`PageFAB`** (canonical) | 52×52 | `rounded-full` | z-50 | 78px | Schedule, Finances, People, Groups, Chats, MyStudents |
| **`AddFab`** (dashboard, expandable) | **58×58** | **`rounded-[18px]`** | **z-40** | **88px** | DashboardPage (tutor + manager) |

So the `+` on the **dashboard is visibly bigger and squarer** than on every other page. `AddFab` is expandable
(3 sub-actions) so it can't be byte-identical, but its base button should match `PageFAB`'s 52px / round / z-50 / 78px.
*(AddFab.tsx:75, PageFAB.tsx:24)* ✓

- **Students have no FAB** on any `/student/*` page (by design — but worth a conscious decision).

**🔴 Hub-tutor dashboard FAB bug ✓** — `DashboardPage.tsx:2546–2549`:
```js
onLesson={() => (isManager ? navigate("/schedule?create=1") : setQuickLessonOpen(true))}
onStudent={() => (isManager ? navigate("/people?add=student") : setAddStudentOpen(true))}
```
The non-manager branch opens `QuickLessonDialog` / `QuickAddStudentDialog`, which query only
`source:'independent'` rows. A **hub tutor** has `source:'hub'` students → the picker is **empty**. This is the
exact invariant in CLAUDE.md ("never point a manager at the quick dialogs") — it was fixed for managers but the
**hub tutor still falls into the broken independent path.** Hub tutor should route to `/schedule?create=1`
(like manager) and should **not** see "Додати учня" (students belong to the manager in the hub model).

### A4. Layout + header — 🔴 DIVERGENT ✓

- **`AppLayout`** — sticky header `h-[52px]`, title `text-[17px] font-extrabold`, `[h1] [NotificationBell]
  [teal burger h-11 w-11 rounded-[14px]]`, wraps children in `OfflineBanner`, has pull-to-refresh.
- **`StudentLayout`** — header `h-14`, title `text-lg font-semibold` (lighter), **no bell, no burger**, no
  `OfflineBanner`. *(StudentLayout.tsx:86–88)* ✓

---

## PART B — Hub-tutor deep dive (flow by flow)

| Flow | Verdict | Detail (file) |
|---|---|---|
| **Dashboard** | 🟢 MODERN | Correct cards, notes-under-bubbles invariant respected, hub payout-only (no margin leak). Now has desktop row matching manager. |
| **Dashboard FAB** | 🔴 BUG | Opens independent-only quick dialogs → empty student list. *(DashboardPage.tsx:2546)* — **P0** |
| **Schedule** | 🟢 MODERN | Same `SchedulePage` + `LessonCard` + bottom-sheet create/edit as manager. Tutor field locked to self. (No price fields for hub — by design; manager sets prices.) |
| **Groups** | 🟢 MODERN | Same `GroupsPage`, modern forms, correct `source:'hub'` tagging, own-student pool, lighter 2-step wizard. |
| **Chats** | 🟢 MODERN | Same `ChatsPage`; "create lesson" routes to the modern `/schedule?create=1&student=` form; no debt chips (correct). |
| **Finances** | 🟢 MODERN | Dedicated hub payout-only branch (received / awaiting), bottom-sheet export, no `student_price`/margin. |
| **Profile** | 🟢 MODERN | Same `ProfilePage`; all 6 contact fields (incl. Instagram/FB/Telegram); correct section gating (no Pro/referrals). |
| **Onboarding** | 🟠 PARTIAL | `OnboardingFlowB` works & is correctly scoped (7 of 13 steps); reachable via first-login redirect + Profile row. **But the sidebar Help entry is hidden** (`showOnboardingHelp = isTutorRole && isIndependent`, AppSidebar.tsx:122). — **P1** |
| **Achievements** | 🟢 MODERN | Reachable (Profile row + open route). |
| **AI notes** | 🟠 PARTIAL | `AiNotesDialog` is mounted and shown during onboarding, but **no dashboard re-entry** afterward (the "ai" task only renders under `isIndependentTutor`). — **P2 parity** |
| **TutorNotesCard** | 🟢 MODERN | Correct position (directly under bubbles). |
| **My students view** | ⚪ NONE (by design) | Hub tutor has no `/people` or `/my-students`; the dashboard "учні хабу" tile links nowhere. Product decision (manager owns students); flag only. |

**Net:** the hub tutor's pages are now mostly modern — the real defects are the **dashboard FAB (P0)** and the
**onboarding sidebar entry (P1)**, plus the **AI-notes re-entry (P2)**. The biggest "old design" the hub tutor
inherits is the shared-chrome issues in Part A (which affect every role), not its own pages.

---

## PART C — Other roles (quick verdicts)

- **Manager** — 🟢 reference implementation (the "good" dashboard / Finances / People you like).
- **Independent tutor** — 🟢 MODERN. Has its own `/my-students` (modern), subscription, referrals. Dashboard FAB
  path is the *correct* one (the quick dialogs are *meant* for independent tutors).
- **Student** — 🔴 the most divergent chrome (Part A): separate `StudentLayout`, no golden bell, no burger,
  smaller sidebar font/icons, no FAB, no offline banner. The student *pages* themselves are fine; the **shell** is
  the old one. This is the single biggest "not analogous" gap in the app.

---

## PART D — Rudiments / dead code (verified, safe to remove) ✓

No live import/render anywhere outside their own file:

| File | Status |
|---|---|
| `src/components/OnboardingContent.tsx` | DEAD body (only a `type StepProgress` is still imported by `OnboardingFlowB`). Task #12 was supposed to delete it. → move the type out, delete the file. |
| `src/components/AutoCompletePromptDialog.tsx` | DEAD (no importers). |
| `src/components/QuickPaymentFab.tsx` | DEAD (no importers). |
| `src/components/QuickActionsFab.tsx` | DEAD (no importers). |
| `src/components/QuickActionsCard.tsx` | DEAD (no importers). *(This is why its sub-44px `h-10/h-9` inputs are NOT a live bug — unreachable.)* |

Removing these is the "rudiments that shouldn't be there anymore" cleanup you mentioned. Low risk (verify the
`StepProgress` type move compiles).

---

## PART E — Forms & date/time

- **Forms:** 🟢 every live dialog/sheet is a modern bottom-sheet (`rounded-t-[…] … sm:rounded-[20px]` + drag
  handle). The `check-ux.mjs` Rule-5 gate enforces it. No old centered data-entry modals remain. (Destructive
  `AlertDialog` confirmations stay centered — correct.)
- **Date/time:** 🟡 works but fragmented — three ad-hoc approaches (shadcn `<Input type=…>`, raw inline-styled
  `<input>` in `QuickLessonDialog`, typed `dd.mm.yyyy` mask). All currently pass the ≥44px / ≥13px floor, but
  there is **no single shared control**, so each new field can drift. Optional: extract one `DateTimeField`.

---

## PART F — Prioritised fix plan

**P0 — functional bug**
1. Hub-tutor dashboard FAB → route "Урок" to `/schedule?create=1`; hide/disable "Додати учня" for hub tutors
   (students are manager-owned). *(DashboardPage.tsx:2546)*

**P1 — the consistency you asked for**
2. **Unify student chrome:** put `/student/*` on the same `AppLayout` + `AppSidebar` (role-filtered nav) so the
   sidebar, golden bell, burger, header sizing and offline banner are identical to every other role. (Biggest
   visible win; medium effort — it changes the student shell.)
3. **Hub-tutor onboarding sidebar entry:** include hub tutors in `showOnboardingHelp` (AppSidebar.tsx:122).
4. **Dead-code cleanup** (Part D) — remove the 5 rudiment files.

**P2 — polish**
5. Align `AddFab` base button to `PageFAB` (52px / `rounded-full` / z-50 / bottom-78) so the dashboard `+`
   matches every other page.
6. Hub-tutor AI-notes dashboard re-entry (parity with independent).
7. Optional shared `DateTimeField`; remove the no-op `golden` prop.

**Suggested order:** P0 (#1) → P1 (#3 sidebar entry, #4 cleanup — both quick) → P1 (#2 student-shell unification,
the larger one) → P2. Each lands behind the 4 gates (tsc / vitest / check-i18n / check-ux) + build, verified per
role, as usual.
