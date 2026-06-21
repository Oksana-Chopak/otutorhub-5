# oTutorHub — Lesson → Payment → Debt → Finances subsystem map

Read-only analysis (2026-06-21). Source of truth = the code paths cited. This documents
the *actual* implementation, the intended model (from CLAUDE.md), and where they diverge.

---

## A. SUBSYSTEM MAP

### A.1 Data model (the money tables)

| Table / view | Grain | Money columns | Who writes |
|---|---|---|---|
| `lessons` | one lesson | (no money) `student_id` (NULL for group), `group_id`, `tutor_id`, `source` ('hub'\|'independent'), `status` | scheduler |
| `lesson_details` | 1:1 with an **individual** lesson | `student_price`, `student_payment_status`, `student_paid_at`, `tutor_payout`, `tutor_payout_status`, `tutor_paid_at`, homework/summary/fireflies | tutor/manager via RPC `update_lesson_details_safe` (student side) and RPC `set_lesson_tutor_payout_status` (payout, manager only); wallet triggers |
| `lesson_participants` | one row per (**group** lesson × student) | `student_price`, `student_payment_status`, `student_paid_at`, currency (+ `tutor_payout*` exist but MUST stay unused/null — students can SELECT own row) | tutor/manager via direct `.update` (RLS FOR ALL) |
| `group_enrollments` | (group × student) config | `price_per_lesson`, currency | manager/tutor |
| `student_rates` | (tutor × student) config | `price_per_lesson`, currency, `source` | manager/tutor |
| `student_wallet_transactions` / `_balances` | prepay ledger | `lessons_delta`, `amount_delta` | RPC; triggers auto-mark lessons paid |
| `lessons_visible` (view) | lessons + details, **NULLs `student_price` for hub tutors** | — | read-only |
| `lesson_details_student` (view) | student-facing details (no payout/fireflies) | `student_price`, `student_payment_status` | read-only |

Key asymmetry to remember: **individual money lives on `lesson_details` (1 row/lesson); group
money lives on `lesson_participants` (1 row/participant). A group lesson has NO `lesson_details`
row.** Anything money-related for groups must read `lesson_participants` directly.

### A.2 Payment-write paths (where state is toggled)

- **Individual, student side** → `update_lesson_details_safe(_lesson_id, _patch)` (SECURITY DEFINER,
  whitelist). **Only writes the keys present in `_patch`.** Does NOT auto-stamp `student_paid_at`.
- **Individual, tutor payout** → `set_lesson_tutor_payout_status(_lesson_id, _status)` (manager only).
  **Does** auto-stamp `tutor_paid_at = now()` server-side.
- **Group, student side** → direct `lesson_participants.update({student_payment_status, student_paid_at})`.
- **Prepay** → wallet triggers set `student_payment_status='paid', student_paid_at=now()` automatically.

### A.3 Per-role lesson→payment→finance flow

**Manager (hub).** Students pay the hub; the hub pays tutors. Hub margin =
`student_price − tutor_payout` per lesson. `FinancesPage` (manager branch, render at line ~2139)
loads up to 500 individual lessons (`lesson_details!inner`, `source != 'independent'`) + up to 500
group lessons (`lesson_participants`, `group_id not null`). Income = Σ paid `student_price`;
Expense = Σ paid `tutor_payout`; Profit = Income − Expense (lines 564–570). Two tabs: **Income**
(`student_payment_status==='paid'`) and **Debts** (`student_payment_status==='unpaid'` OR
`tutor_payout_status==='unpaid'`). Group rows show payout/profit as "—".

**Hub tutor.** Paid a payout by the hub; must NEVER see `student_price`/margin. Dedicated
payout-only branch (line ~1482): "Received" = Σ paid `tutor_payout`, "Pending" = Σ unpaid; read-only
(the hub marks payouts). Group lessons excluded (no tutor payout tracked for groups).

**Independent tutor.** Collects directly; no hub margin. "Cockpit" branch (line ~1687) with Ops /
Debts / Analytics tabs. Income = Σ paid `student_price`; no payout/profit columns anywhere. Debts
tab lists `completed && unpaid`, with per-lesson **Remind** + mark-paid.

**Student.** `StudentPaymentsPage` reads individual via `lesson_details_student` (by `lesson_id`)
+ group via `lesson_participants` directly (by `student_id`); "to pay" = Σ unpaid `student_price`,
grouped by currency. Sees both lesson types. `StudentDashboardPage` pending count includes both.

### A.4 Reminder flow

`remind-payment` edge function (manager or the lesson's tutor) sends Telegram + email for ONE
lesson, keyed by a real `lessonId`. Callers: `PendingPaymentsCard` (line 175), `FinancesPage`
single (706) + bulk (2295) + debt-alert (2295), independent Debts tab (1948).

---

## B. BUG LIST (prioritized)

### P0-1 — Marking a payment PAID never stores `student_paid_at` (individual lessons) on FinancesPage
**This is the "marking paid removes it from Debts and it appears NOWHERE" report.**
- **Where:** `FinancesPage.tsx:693–699` (`writeStudentPayment`). For individual lessons it calls
  `updateLessonDetailsSafe(lesson.id, { student_payment_status: status })` — **passes only the
  status, never `student_paid_at`.** The inline comment (line 691) claims "student_paid_at is set by
  a DB trigger there" — **there is no such trigger.** `update_lesson_details_safe`
  (migration `20260620230022`) only writes a column if its key is in the patch (line `student_paid_at = CASE WHEN _patch ? 'student_paid_at' …`).
- **Root cause:** false assumption of a DB trigger. The manual mark-paid path persists
  `student_payment_status='paid'` with `student_paid_at = NULL`.
- **User-visible effect:** The row DOES still satisfy the Income-tab filter (`student_payment_status==='paid'`),
  so it should reappear under **Income** — BUT (a) the owner is on the **Debts** tab (the page
  auto-switches to Debts when any debt exists, line 190–193) and never sees it move to Income; (b)
  the Income row and all paid-date sorts/labels render blank "paid date" because `student_paid_at`
  is null (lines 1086, 1288, 933 CSV); (c) any future logic keyed on `student_paid_at` (reporting,
  "paid this period by paid-date") silently drops it. So from the owner's seat the lesson "vanishes".
  Contrast: `DashboardPage.updatePayment` (lines 776–778) DOES pass `student_paid_at` — so the SAME
  action behaves differently depending on which screen you mark it from. That inconsistency is the
  smell the owner felt.
- **Coherent fix:** make the write self-consistent in ONE place. In `writeStudentPayment`, for the
  individual branch pass `student_paid_at` too:
  `updateLessonDetailsSafe(lesson.id, { student_payment_status: status, student_paid_at: paidAt })`
  (the function already computes `nextPaidAt`/passes `paidAt`). Better: stamp it server-side in
  `update_lesson_details_safe` (when `student_payment_status` transitions to 'paid' and no explicit
  paid_at given, set `now()`; on 'unpaid', clear) so EVERY caller — Finances, Dashboard, bulk,
  PendingPaymentsCard, RecordPaymentSheet — is correct regardless of payload. Mirror the payout RPC,
  which already does exactly this. Remove the false "trigger" comment.
- **Touches / cross-role:** individual lessons only; affects manager + independent + hub-tutor (payout
  side is fine). `bulkMark` (852–863) and the independent "mark all" (1914) and `markPaid` in
  `PendingPaymentsCard` (156–163) ALL go through `updateLessonDetailsSafeBulk`/`updateLessonDetailsSafe`
  with status-only payloads → same missing-stamp bug; a server-side stamp fixes all at once. Group
  path already stamps `student_paid_at` (lines 697, 860) so it's only the individual path.
- **Optimistic-UI note:** `togglePayment` optimistically sets `student_paid_at` locally (line 735), so
  before a reload the UI looks right; after a refetch the null comes back from the DB. That's why it
  "works then breaks on reload."

### P0-2 — `remind-payment` is broken for GROUP lessons (404), and group debts have no reminder
**This is the "group lessons → remind errors 'Учень не має ні Telegram, ні email'" report.**
- **Where (edge fn):** `supabase/functions/remind-payment/index.ts:54–61` selects
  `lessons … lesson_details!inner(…)` and `.eq("id", lessonId)`. A group lesson has **no
  `lesson_details` row**, so `!inner` returns nothing → `lessonRow` null → **404 "Lesson not found"**.
  Even if it joined, line 87 reads `lesson.student_id` which is **NULL** for a group lesson, so it
  could never resolve the right student/contact.
- **Where (callers):** No caller can make group reminders work. The FinancesPage group rows have a
  **synthetic id** `${lessonId}::${participantId}` (line 341). The independent Debts tab calls
  `remindLesson(l.id, l.student_id)` (line 1948) with that synthetic id; the manager debt-alert and
  `remindLesson` (706, 2295) pass `l.id`. For a group row `l.id` is the synthetic string → 404
  (`error`), surfaced as `pendingPayments.reminderFailed` or, when `success:false`, the misleading
  `pendingPaymentsExtra.noContact` ("Учень не має ні Telegram, ні email") — exactly the owner's error.
- **Mitigation already present (inconsistent):** `PendingPaymentsCard` HIDES the remind button for
  group rows (`{r.kind !== "group" && …}`, line 325). FinancesPage does NOT hide it → it offers a
  button that always fails for groups. So the two surfaces disagree.
- **Root cause:** the reminder function predates group billing and is hard-wired to individual
  `lesson_details` + `lessons.student_id`. The synthetic-id scheme never reaches the function.
- **Coherent fix (two parts):**
  1. **Edge fn:** accept an optional `participantId` (or detect a group lesson). When the lesson is a
     group lesson, resolve the student from `lesson_participants` (by `participantId`, or by
     `lesson_id`+`studentId`), read `student_price`/status from there instead of `lesson_details`,
     and skip the `lesson_details!inner` requirement (use a left join or branch). Authorization stays:
     manager OR `lesson.tutor_id === user.id`.
  2. **Callers:** for group rows pass `{ lessonId: realLessonId, participantId, studentId }` — the
     FinancesPage row already carries `participant_id` and the real lesson id is the part before
     `::`. Until the fn supports it, FinancesPage should HIDE the remind button for group rows (match
     `PendingPaymentsCard`) so it never offers a guaranteed-failing action.
- **Touches / cross-role:** manager + independent + hub (hub uses payout view, no student remind).
  Both lesson types. Don't regress the individual path. The "Учень не має ні Telegram, ні email"
  toast is also wrong for the genuine no-contact case vs the group-404 case — they should be
  distinguished (see P2-1).

### P1-1 — FinancesPage group rows: student name "—" and broken interactions because the synthetic id collides with profile/selection logic
**This is "group lessons show NO student in Finances" — partly real, partly a related defect.**
- **Where:** group rows are built at `FinancesPage.tsx:336–353` with `student_id = p.student_id`
  (correct) so `nameOf(l.student_id)` SHOULD resolve. BUT the profiles map only contains the 300
  profiles fetched (line 304, `.limit(300)`), and group participants' student profiles are only
  present if they happen to be in that page — for a hub with many people, a participant's profile may
  be missing → `nameOf` returns "—". More importantly, several actions key off `l.id` (the synthetic
  string), not the participant: `togglePayment` reverts/looks up by `l.id` (works, since rows carry
  it), but **`set_lesson_tutor_payout_status`/bulk payout** and the `markLessonPaidById` /
  `RecordPaymentSheet` path treat `l.id` as a real lesson id. `unpaidLessonsForSheet` (675–687) maps
  group rows with `id: l.id` (synthetic) → if a manager records a payment against that "lesson" via
  the sheet (`onMarkLessonPaid` → `markLessonPaidById` → `togglePayment`), it routes correctly only
  because `togglePayment` re-resolves `kind`; but the sheet's own unpaid-lesson list shows a synthetic
  id that does not correspond to a real lesson the rest of the app knows.
- **Root cause:** (a) profiles fetched with a hard `.limit(300)` and no `.in(ids)` targeting, so group
  participants can be missing from `profiles`; (b) the synthetic-id flattening is leaked into surfaces
  (RecordPaymentSheet) that assume real lesson ids.
- **Coherent fix:** (a) fetch profiles for ALL referenced ids (collect student+tutor+participant ids
  from lessons, group participants, transactions, balances, rates and `.in("id", ids)` instead of a
  blind 300-row page) — this is the direct cause of "no student shown". (b) Exclude group rows from
  `unpaidLessonsForSheet` (the sheet marks individual lessons by `lesson_id`; group payment belongs in
  the lesson dialog's per-participant UI), OR teach the sheet about participant ids. Keep the synthetic
  id strictly internal to the Finances list.
- **Touches:** manager + independent finances; group lessons. Verify the student name now renders and
  the RecordPaymentSheet no longer lists synthetic group ids.

### P1-2 — Income/paid lessons silently disappear when they fall outside the selected period
- **Where:** `incomeRows`/`debtsRows`/totals all derive from `periodBillable = billable.filter(inPeriod(starts_at))` (438–442, 523–553). Period defaults to **month** (line 174). A lesson paid today
  but dated last month is `paid` yet `inPeriod` is false → it shows in NEITHER Income (this month) nor
  Debts. Combined with P0-1 (no `student_paid_at`), there is also no way to filter "paid *this month*
  by payment date".
- **Root cause:** period filter keys on `starts_at` (lesson date), not payment date, and the default
  month window hides older-but-just-paid lessons. To a user who just marked an old debt paid on the
  default view, it "disappeared".
- **Coherent fix:** acceptable as-is IF the empty-state/labels make clear the view is period-scoped by
  lesson date; better: when on the **Income** tab, scope by `student_paid_at` (now reliably set after
  P0-1) instead of `starts_at`, so "this month's income" = money actually received this month. At
  minimum, after marking an out-of-period debt paid, toast should hint it moved to Income/another
  period. Low risk but interacts with P0-1 — fix P0-1 first.
- **Touches:** manager + independent income views. Don't change the Debts logic (debts are inherently
  about the lesson, fine on `starts_at`).

### P1-3 — Independent "mark all paid" and dashboard bulk are NOT optimistic / lack haptic + can leave stale UI
- **Where:** independent Debts "Відмітити всі" (`FinancesPage.tsx:1909–1925`) awaits all writes, THEN
  updates local state, with no haptic/confetti and no revert-on-error; the per-row ✓ uses
  `togglePayment` (good). The big debt-alert "Нагадати" (2284–2308) awaits all `remind-payment` calls
  before any feedback.
- **Root cause:** violates the documented "marking a payment must give INSTANT feedback" invariant for
  the bulk paths (only `togglePayment` was made optimistic).
- **Coherent fix:** make "mark all" optimistic (flip local state first, haptic.success + toast, then
  await, revert on error) — same pattern as `togglePayment`/`bulkMark`. Note `bulkMark` (835–883) IS
  optimistic+confetti; the independent "mark all" is a separate, non-optimistic copy → unify on the
  `bulkMark` pattern.
- **Touches:** independent finances; manager `bulkMark` already correct.

### P1-4 — "Налаштувати →" upsell jumps to /profile top, not the reminder setting (torn jump)
- **Where:** independent Debts tab upsell `<Link to="/profile">` (`FinancesPage.tsx:1888`). The actual
  auto-reminder toggle (`payment_reminder_enabled`) lives in `ProRulesCard`, rendered at
  `ProfilePage.tsx:680` inside `<div id="rules">`. The link omits the `#rules` anchor, so it lands at
  the top of a long profile page with no visible connection to reminders — the "torn jump" the owner
  flagged.
- **Root cause:** missing hash target; copy promises "auto-reminders in the rules" but routing doesn't
  take you there.
- **Coherent fix:** `to="/profile#rules"` and ensure ProfilePage scrolls the `#rules` anchor into view
  on load (add a scroll-to-hash effect if not present). Verify `ProRulesCard` actually exposes a
  payment-reminder toggle for independent tutors (it gates on Pro/independent); if not, point the
  upsell at the real setting or remove the promise. Confirm copy ("в правилах") matches the section
  title.
- **Touches:** independent tutor only (Debts tab). Verify `#rules` exists and the toggle is reachable.

### P2-1 — CSV "Завантажити CSV" feels like it does nothing for an independent tutor
**This is the "Завантажити CSV does nothing / not react for an independent tutor" report.**
- **Where:** independent export button `setExportOpen(true)` (1618/2098/2124) opens the SHARED dialog
  rendered at lines 1651–1679 inside the hub-tutor branch... but the **independent branch returns
  before that dialog** (independent `return` is at 1731; the dialog at 1651 is inside the
  `if (isHubTutor)` block that returned at 1514). **The independent render path has NO `<Dialog open={exportOpen}>` mounted** — its three export buttons set `exportOpen=true` but no dialog is in the
  independent subtree, so nothing appears and nothing downloads. (The manager dialog at 2521 and the
  hub dialog at 1651 are each inside their own early-returned branch.)
- **Root cause:** the export `<Dialog>` is duplicated per-branch; the independent branch (returns at
  1731–2136) was never given one. So `setExportOpen(true)` is a dead toggle there.
- **Coherent fix:** add the export `<Dialog open={exportOpen} …>` to the independent render subtree
  (reuse the same dialog markup as 1651, kind-only is fine since independent has no tutor filter), or
  lift the dialog to a shared spot rendered by all branches. `exportCsv` itself is correct for the
  independent case (emits student-billing-only columns) — the only issue is the dialog never mounts.
- **Touches:** independent tutor only. Verify hub + manager CSV still open (they have their own
  dialogs). After fix, confirm a download actually fires and the success toast shows.
- **Secondary:** even with a dialog, if `periodBillable` is empty for the chosen period the CSV is
  header-only and "feels" like nothing happened — consider disabling export / showing "no rows for
  this period" when empty.

### P2-2 — `noContact` toast is shown for genuine 404/transport failures (misdiagnosis)
- **Where:** `FinancesPage.tsx:716–718`, `2300–2302`; `PendingPaymentsCard.tsx:187–189`. Any
  `success:false` (incl. group-404 surfaced via P0-2, or `no_channels`) shows
  `pendingPaymentsExtra.noContact` "Учень не має ні Telegram, ні email — додайте контакт", even when
  the real cause is a 404 / group lesson / email-send failure (`emailReason`). Misleads the owner into
  "fixing" a contact that is fine.
- **Coherent fix:** branch on the fn's `reason` (`no_channels` vs not-found vs email error) and show an
  accurate message; only say "no contact" when `hasEmail===false && hasTelegram===false`. Depends on
  P0-2 for groups.
- **Touches:** all reminder surfaces, both lesson types.

### P2-3 — Manager pending list relies on `lessons_visible` which NULLs `student_price` for hub tutors (not a manager bug, but a shared-component trap)
- **Where:** `DashboardPage` loads pending from `lessons_visible` (per the sub-agent trace, ~line 464),
  which NULLs `student_price` for hub tutors. For a **manager** it's fine (manager sees prices). Flagged
  only so a future refactor doesn't reuse `lessons_visible` for a hub-tutor money surface and silently
  zero out amounts. No fix needed now; documented as an invariant.

### P2-4 — `text-xs` (12px) violations in the money UI (a11y invariant)
- **Where:** `FinancesPage.tsx:2274` (`<span className="text-xl">`) is fine, but grep your diff: several
  finance components historically used `text-xs`. CLAUDE.md hard-bans <13px. Not a logic bug; call out
  during the fix so the build gate (`check-ux`) stays green. (Most finance text is inline `fontSize` ≥13,
  which is compliant.)

---

## C. Fix order (respecting interdependencies)

1. **P0-1** server-side `student_paid_at` stamp in `update_lesson_details_safe` (fixes Finances,
   bulk, PendingPaymentsCard, RecordPaymentSheet at once) + remove the false trigger comment.
2. **P0-2** group-aware `remind-payment` (fn + callers) and hide the remind button for group rows in
   FinancesPage until shipped (match PendingPaymentsCard).
3. **P1-1** fetch all referenced profiles (`.in(ids)`), keep synthetic ids out of RecordPaymentSheet.
4. **P1-4** `/profile#rules` + scroll-to-hash. **P2-1** accurate reminder error copy (after P0-2).
5. **P1-2** income scoped by payment date (after P0-1). **P1-3** optimistic bulk. **P2-2** CSV dialog
   for independent.

Verify after each: tsc + vitest + check-i18n + check-ux, then eyeball **all four roles** (manager,
hub tutor, independent tutor, student) on **both** lesson types — mark a payment from BOTH Dashboard
and Finances and reload to confirm `student_paid_at` persists and the lesson lands in Income.
