# oTutorHub — Дизайн + user-flows аудит

**Дата:** 2026-07-03 · **HEAD:** a347807 · **Метод:** 6 паралельних аудиторів (4 ролі + наскрізні journeys + DS-звірка) → адверсарна верифікація (перервана лімітом після 4 підтверджених/0 спростованих; решта верифікується інлайн у ході ремедіації).

**Підсумок:** 57 унікальних знахідок — 12 HIGH · 30 MED · 15 LOW.

## ✅ Ремедіація (2026-07-03, коміти `6f9e00c…`)

**Виправлено ~50/57** (усі 12 HIGH; MED/LOW — крім свідомо відкладеного нижче), включно з: груповий MON-2 lockdown (міграції `20260719000000`+`20260720000000`), менеджерська картка «Учні»=0, глобальний десктоп-дзвіночок, видимість уроку «йде зараз», чат-леаки учням, ціни онбординг-уроків, зламаний Zoom-бонус, сповіщення по всіх journey (призначення, життєвий цикл уроку, рішення по скасуваннях, виплати), календар-синк, домашка «в Архів», WCAG-сірий у ~40 місцях, 12px лендінгу (+ гейт тепер сканує kebab-case), тач-таргети, скелетони, теплі empty-стани, i18n діалогів.

**Потребує дій Lovable:** редеплой `lesson-reminders` (студентські deep-links); застосувати міграції у порядку `20260714000000` → `20260715000000` → `20260718000000` → `20260720000000` → `20260721000000` (стан на 2026-07-04: типи показують, що жодна з них не жива; водночас фронтенд уже читає `lesson_participants_visible` — групові гроші зламані в прод до застосування `20260720000000`).

**Дороблено 2026-07-04 (коміт `7250daa`):** мультивалютні підсумки (#16 — `sumByCurrency`, домінантна валюта + компактний хвіст на Фінансах/дашборді незалежного); штраф за скасування (#37 — маркер `lesson_details.is_cancellation_fee`, міграція `20260721000000`, амбер-тег «штраф» на Фінансах і у платежах учня, graceful fallback до застосування); картка «⏳ Запит у роботі» на дашборді учня (#40).

**Свідомо відкладено:** DB-дедуп create_notification (#42 — мітигейтовано per-entity типами на клієнті); ManagerNotes title/perMonth дрібниці (#33); валюта в онбординг-формі (#20 — навмисна простота, UAH-дефолт).

---

## HIGH

### join-lesson (first-value core action)
*роль:* student · *файл:* `src/pages/student/StudentDashboardPage.tsx:96-102 (+ StudentSchedulePage.tsx:74-75)` · *статус:* ⏳

- **Що:** A lesson that is IN PROGRESS is invisible where the student needs it most. The dashboard upcoming query filters `.eq("status","scheduled").gte("starts_at", nowIso)` (lines 99-100), so a lesson that started even 1 minute ago is not fetched at all — the glowing «Приєднатися зараз» / «Йде зараз» state (computed at lines 259-271) can never appear on a fresh load during the lesson; it only works if the page was already open before start (the 30s nowTick only re-renders prefetched rows). On StudentSchedulePage the tab split is `upcoming = starts_at >= now` / `past = starts_at < now` (lines 74-75), so the ongoing lesson jumps into the «Минулі» tab at the exact start moment (mid-view, since `now` ticks) — the live join button renders, but hidden behind a tab labelled 'Past' while the default tab shows the lesson as absent.
- **Чому:** CLAUDE.md binding invariant (Student core actions): the join CTA must be glowing 'from 15 min before start THROUGH LESSON END, with «йде зараз» status'. The single most common real scenario — a student opens the app right at/after lesson start to grab the link — shows an empty dashboard («Найближчі уроки» without the current lesson) and a schedule that claims the running lesson is already 'past'. This is a dead-end on the app's #1 student action.
- **Фікс:** Dashboard: fetch with a lookback window (e.g. `.gte("starts_at", new Date(Date.now() - 4*60*60*1000).toISOString())`) and client-filter to `endMs = starts_at + duration_minutes >= nowTick` before slicing to 3, so in-progress lessons stay pinned until end. Schedule: split tabs by END time — `upcoming = starts_at + (duration_minutes ?? 60)*60000 >= now` — so a live lesson stays in «Майбутні» until it actually finishes. Re-verify the «йде зараз» label appears on a cold load mid-lesson.

---

### chats — tutor-only concepts leak to students
*роль:* student · *файл:* `src/pages/ChatsPage.tsx:244-291, 991-1019, 1278-1339 (+ App.tsx:112)` · *статус:* ⏳

- **Що:** The thread-list context pills and in-conversation 'smart card' have NO student gate (only the context PANEL is gated via `canShowContext`, line 117). The ctx is computed for every non-manager (line 244+): (a) a student of an INDEPENDENT tutor with unpaid lessons (source!=='hub' passes the line-267 filter) sees on their own chat row «Борг ₴X · N ур.» with «Нагадати →» (lines 1008-1012), and inside the conversation an amber card «Неоплачено ₴X» whose button pre-fills the STUDENT's draft with the tutor-voiced reminder «Доброго дня! Нагадую про оплату за уроки 🙏» (uk.ts:841) to send TO their tutor; (b) a pair with no lessons yet gets ctx 'new' → the student sees «Новий учень» + «Створити урок →» and the smart-card button «Створити» navigates the student to `/schedule?create=1&student=<their own id>` (lines 1319-1322) — and App.tsx:112 guards /schedule with a bare ProtectedRoute (no allowedRoles), so the student actually lands on the tutor/manager SchedulePage create flow.
- **Чому:** Directly violates the audit requirement that a student never sees tutor-only/manager-only concepts: «Новий учень» describes the student themselves from the tutor's viewpoint, the debt-reminder is a tutor action, and «Створити урок» drops a student into the tutor scheduling surface — confusing, role-breaking, and reachable from the student's main Chats tab (studentNav links /chats).
- **Фікс:** Gate the ctx pills (line 992) and smart card (line 1279) on `!roles.includes("student")` (reuse canShowContext), or compute a student-appropriate ctx instead (e.g. debt → «До оплати: X ₴» linking to /student/payments; drop 'new' entirely for students). Additionally add `allowedRoles={["manager","tutor"]}` to the /schedule route in App.tsx (students have /student/schedule).

---

### onboarding / first-value path
*роль:* independent-tutor · *файл:* `src/components/OnboardingFlowB.tsx:405-435` · *статус:* ⏳

- **Що:** LessonAction.saveLesson creates the tutor's FIRST lesson(s) with a hardcoded `student_price: 0` (`updateLessonDetailsSafe(created.id, { student_price: 0, student_payment_status: "unpaid" })`, repeated for the 3 weekly-repeat copies at :429-432), even though the student's real price was just captured in the previous StudentAction step (written to student_rates via add_or_link_independent_student) and even though the canonical flow (QuickLessonDialog.tsx:277) snapshots `student_price: selected.price || 0` from the rate. onComplete(id, name, subject) at :294 drops the price, and the fallback resolver at :364-372 selects only `student_id, subject` — never price_per_lesson.
- **Чому:** The exact first-value money loop breaks: a tutor who enters ₴500 in onboarding, schedules the first lesson (plus 3 repeats), marks it done and goes to record a payment sees 0 ₴ everywhere — Finances debt list shows '⚠️ Не отримано 0 ₴', the dashboard payment toast is silently suppressed (DashboardPage.tsx:688 gates it on student_price > 0), CloseDayDialog shows 0, and the trial-ending banner's 'ти заробила X ₴' stays 0. The product looks broken exactly at the aha-moment; the FinanceBonus step even renders a fake ₴500 demo card (OnboardingFlowB.tsx:809) next to real 0-₴ data.
- **Фікс:** Pass the price through: extend StudentAction.onComplete to also return the entered price (and currency), store it in cross-step state next to addedStudentId, and in saveLesson write `student_price: addedPrice` (for the fallback path, add `price_per_lesson` to the student_rates select at :366 and use it). Apply to all 4 inserts (first + 3 repeats).

---

### dashboard regression (introduced by this remediation)
*роль:* manager · *файл:* `src/pages/DashboardPage.tsx:1559, 1610` · *статус:* ⏳

- **Що:** The MANAGER's «Учні» stat card (mobile at :1559 and desktop 4-col at :1610, both inside `{isManager && …}`) now renders `{myStudentCount ?? 0}` — but `setMyStudentCount` fires ONLY for independent tutors (:522-524, fed by the `isIndependentTutor ? … : noop` query at :473-475). The old manager-scoped `studentCount` (:173, set at :437) is now rendered nowhere (diff cb33ef7..HEAD replaced all four studentCount renders with myStudentCount, including the two manager cards).
- **Чому:** The audit fix for 'independent Students card always 0' over-rotated and broke the manager's headline metric instead: every manager now sees «Учні: 0» on the primary screen regardless of how many students the hub has — the same class of broken-core-metric bug the audit called HIGH, just moved to another role (violates the 'apply fixes to all roles, no regressions' rule).
- **Фікс:** In the two manager cards render the manager-scoped count again (`{studentCount}` — it is still correctly computed from user_roles at :437, and managers CAN read all roles under RLS), keeping `myStudentCount` only in the independent block (:1429, :1472). Verify both roles after the edit.

---

### onboarding Zoom bonus step
*роль:* independent-tutor · *файл:* `src/components/OnboardingFlowB.tsx:976-984` · *статус:* ⏳

- **Що:** ZoomBonus.save upserts `{ tutor_id, default_meeting_url }` into tutor_student_defaults with `{ onConflict: "tutor_id" }`. The table requires `student_id uuid NOT NULL` and its only unique constraint is `UNIQUE (tutor_id, student_id)` (migration 20260422071254:9-17; types.ts Insert requires student_id) — so the write ALWAYS fails (NOT NULL violation, and onConflict has no matching unique constraint → 42P10). The error is never checked: the code proceeds to `onComplete()` which marks the step done, awards XP and closes the sheet.
- **Чому:** The '🎥 Додай Zoom-лінк' bonus step is a silent no-op with a fake success celebration: the tutor believes their meeting link is saved, but no lesson ever gets it and useOnboardingProgress.hasMeetingUrl (which reads tutor_student_defaults.default_meeting_url) stays false — so the dashboard keeps nagging with the same Zoom task the tutor already 'completed', which reads as the app being broken.
- **Фікс:** A tutor-wide default link has no home in this per-pair table. Either write the link to all of the tutor's existing pairs (upsert one row per student with onConflict "tutor_id,student_id") or persist it in a real tutor-level field; in all cases check the upsert error and toast instead of calling onComplete() on failure.

---

### typography — 13px floor (INVIOLABLE invariant) + gate blind spot
*роль:* all (prospective users, landing) · *файл:* `src/pages/LandingPage.tsx:191, 389, 425, 488 (+ src/components/LandingTryDemo.tsx:279, 316)` · *статус:* ⏳

- **Що:** Readable text at 12px in CSS-in-JS template strings: LandingPage `.section-label` (:191 `font-size: 12px`), `.price-badge` (:389), `.price-note` (:425 — the pricing caveat under the CTA), `.pain-label` (:488); LandingTryDemo `.ltd-label` (:279) and `.ltd-tab` at 12px on mobile (:316 — interactive tab labels of the try-demo). These evade scripts/check-ux.mjs because its regexes match only `text-[Npx]`, camelCase `fontSize:` and `text-xs` (plus .css files) — kebab-case `font-size:` inside .tsx template literals is unscanned, so the gate stays green.
- **Чому:** CLAUDE.md marks the 13px floor as a 🔒 INVIOLABLE binding ТЗ with NO exception for the landing (users have ~80% vision, read outdoors in sunlight); the landing is the acquisition surface and the 12px price-note is exactly the text a prospect must read. This is the documented recurring-regression class (green gate ≠ proof), reproduced through a fresh gate blind spot.
- **Фікс:** Bump all six declarations to 13px+ (the uppercase letter-spaced labels read fine at 13px). Then close the gate hole: add a `font-size:\s*(\d+(?:\.\d+)?)px` scan over .tsx contents (template-literal CSS) to check-ux.mjs rule 2 so kebab-case CSS-in-JS can never slip past again.

---

### DashboardPage — stat bubbles
*роль:* manager · *файл:* `src/pages/DashboardPage.tsx:1559, 1610 (render); 473-475, 522-524 (source); 437 (unused correct value)` · *статус:* ⏳

- **Що:** The MANAGER's «Учні» stat card always shows 0. Both manager renders — mobile (line 1559) and desktop 4-col grid (line 1610) — display `{myStudentCount ?? 0}`, but `myStudentCount` is loaded ONLY when `isIndependentTutor` (line 473-475: `isIndependentTutor ? supabase.from("student_rates")...eq("tutor_id", user.id).eq("source","independent") : noop`; set at 522-524 inside `if (isIndependentTutor)`). `isIndependentTutor = isTutor && !isManager && isIndependent` (line 138) is false for every manager, so the value stays null → 0. The correct hub-wide `studentCount` (set at line 437 from user_roles) is computed but no longer rendered anywhere. Introduced by remediation commit 332afaa, which replaced `studentCount` with `myStudentCount ?? 0` in all four card instances instead of only the two independent-tutor ones (the audit fix explicitly said 'keep studentCount for the manager grid only').
- **Чому:** A manager's primary dashboard metric is permanently wrong: the Students bubble reads 0 no matter how many students the hub has, and tapping it opens /people showing a full list — an immediate count≠list contradiction on the first screen the owner sees every day. This is the exact mirror of the audited HIGH bug, reintroduced by its own fix.
- **Фікс:** In the `{isManager && (...)}` block render `studentCount` again at lines 1559 and 1610 (mobile + desktop manager cards); keep `myStudentCount ?? 0` only in the isIndependentTutor cards (1429, 1472). Re-verify all 4 role dashboards after the edit per the no-regression rule.

---

### Journey 4 — cancellation fee rules
*роль:* independent-tutor + student · *файл:* `src/components/TutorChangeRequestsCard.tsx (+ src/lib/financials.ts, src/pages/student/StudentPaymentsPage.tsx):TutorChangeRequestsCard.tsx:186-214; financials.ts:26-33; FinancesPage.tsx:475-480; StudentPaymentsPage.tsx:59,84; WalletDialog.tsx:163` · *статус:* ⏳

- **Що:** The cancellation FEE is written but is invisible on every money surface — dead-end money. When a tutor approves a student's cancel request with charge 'partial'/'full', approve() sets lessons.status='cancelled' then writes the fee via updateLessonDetailsSafe(lesson.id,{student_price:newPrice}) with status left 'unpaid' (TutorChangeRequestsCard.tsx:192-214). But isBillableLesson (financials.ts:28) returns false for status==='cancelled', and ALL tutor money views derive from it (FinancesPage.tsx:475-480 'Excludes: cancelled' → totals, debts tab, RecordPaymentSheet unpaidLessonsForSheet:713-715). The student side also excludes cancelled everywhere: StudentPaymentsPage.tsx:59 '.neq("status","cancelled")', :84 group branch, WalletDialog.tsx:163, and StudentDashboardPage.tsx:120-125 explicitly subtracts cancelled ids from the «До оплати» count. charge_decision is written once (TutorChangeRequestsCard.tsx:237) and read NOWHERE (grep: zero readers). The DB trigger apply_late_cancellation_fee (20260513000800) only fires when auth.uid()=student_id — but students can never set lessons.status directly (they go through the request flow where the TUTOR updates), so the automatic fee + notify-cancellation-fee edge fn are unreachable in the real flow too.
- **Чому:** The tutor taps «Утримати оплату повністю/частково», sees a success toast — and the fee then appears in NO debt list, NO income total, NO record-payment sheet; the student never sees they owe it and gets no notification. QuickLessonDialog even sends students the cancellation RULES promising these fees (QuickLessonDialog.tsx:311-335), so the app actively advertises a fee it can never collect or display. Real money silently vanishes at the exact moment the feature promises protection.
- **Фікс:** Make a cancelled lesson with student_price>0 and student_payment_status='unpaid' count as billable (extend isBillableLesson: cancelled && Number(student_price)>0 → true) and include it on StudentPaymentsPage (drop the .neq for rows whose lesson_details_student.student_price>0, label it via charge_decision as «штраф за скасування»). Notify the student of the fee in approve() (insertNotification with amount + link /student/payments). Add a financials.test.ts case locking the fee-visibility rule.

---

### Journey 1 — invite a tutor
*роль:* manager + tutor · *файл:* `src/pages/PeoplePage.tsx (+ src/components/InviteLinkDialog.tsx, supabase/functions/send-student-invite/index.ts):PeoplePage.tsx:710-716, 727-736, 2067-2076; InviteLinkDialog.tsx:123-133; uk.ts:3159; send-student-invite/index.ts:147-148` · *статус:* ⏳

- **Що:** Inviting a TUTOR falsely claims an email was sent — no email ever goes out to tutors. addPerson auto-sends the invite only for students (PeoplePage.tsx:712 'if (addForm.role === "student" && email)'), and passes studentId:null for tutors (:733). Yet InviteLinkDialog's description branch keys only on email presence (InviteLinkDialog.tsx:125-131): for a tutor with an email it renders descEmailTutor = «Ми надіслали репетитору запрошення на email. Після реєстрації профіль автоматично зв'яжеться з вашим» (uk.ts:3159) — a false statement; and because studentId is null, even the fallback «надіслати email» button (lines 158-166) doesn't render. Additionally, the «Нагадати» action for a pending tutor (PeoplePage.tsx:2074) passes studentId:u.id into the same dialog, whose resend calls send-student-invite — a function that sends the STUDENT-templated email with a hardcoded role=student signup URL (index.ts:148) to a person who must register as a tutor.
- **Чому:** Journey 1 dies at step one: the manager closes the dialog believing the tutor was emailed; the tutor never receives anything and stays «⏳ Очікує реєстрації» forever unless the manager happens to copy the link manually. If the manager later uses «Нагадати», the tutor gets a student-flavored invite whose link preselects the student role — confusing and off-brand for the hub's own staff.
- **Фікс:** Either (a) add a role-aware invite path: make send-student-invite accept a role (or add send-tutor-invite) with a tutor template + role=tutor URL, auto-send it in addPerson for tutors, and pass the ghost id so resend works; or (b) minimally, change the dialog copy for tutors to the honest descNoEmailTutor variant whenever emailSent=false, and hide/replace the «Нагадати» email resend for tutors with the copy-link flow.

---

### Journey 4 — cancel/reschedule decision
*роль:* student + tutor · *файл:* `src/components/TutorChangeRequestsCard.tsx:173-255 (approve), 257-277 (reject); StudentLessonActions.tsx:58-95` · *статус:* ⏳

- **Що:** The tutor's decision on a student's cancel/reschedule request never notifies the student — «notifications both ways» is one-way. StudentLessonActions pings the tutor on submit (insertNotification at :115-120/:147-152), but TutorChangeRequestsCard contains ZERO notification calls (no insertNotification import; grep of all insertNotification call sites confirms). approve() for reschedule silently rewrites lessons.starts_at (:221-231) — possibly to a time DIFFERENT from what the student proposed (proposedAt is editable, :475-481) — and reject() (:257-277) just flips the request row. On the student side the only signal is the pending badge, which queries status='pending' (StudentLessonActions.tsx:66) and simply disappears after any decision; tutor_response is read by no component (grep: zero readers outside these two files).
- **Чому:** A student who asked to move Thursday's lesson gets no answer at all: the badge vanishes identically whether the tutor approved or rejected, the lesson may silently jump to a third time the tutor typed, and the tutor's written response (tutor_response) is stored but never shown to anyone. The student can show up at the old time or not show up at the new one — the highest-stakes coordination moment in the product is silent.
- **Фікс:** In approve()/reject(), insertNotification to active.student_id: type unique per request (e.g. `change_request_${active.id}`, see QuickLessonDialog's per-entity pattern to dodge the 24h dedup), title with the outcome + new date for reschedules + charge decision for cancels, body = tutor_response, link '/student/schedule'. Also surface the decided request (status+tutor_response) on the student's lesson card for a few days.

---

### security / MON-2 (hub margin privacy)
*роль:* hub-tutor · *файл:* `src/components/GroupLessonParticipants.tsx:42, 74-85, 122-146 (+ src/pages/GroupsPage.tsx:122, 728-740, 1014-1032; supabase/migrations/20260508080932...sql:13-16; 20260506052723...sql:33-38)` · *статус:* ⏳

- **Що:** The GROUP path of the hub-money lockdown was never closed: a hub tutor both READS and WRITES per-student hub group money. GroupLessonParticipants selects `id, student_id, student_price, currency, student_payment_status` directly from lesson_participants (line 42), renders each participant's price (line 128) and lets the owning tutor toggle student_payment_status via a direct `supabase.from("lesson_participants").update(...)` (lines 74-85) — LessonDetailsDialog passes `canEdit={manager || (tutor && row.tutor_id === user.id)}` with no hub gate (LessonDetailsDialog.tsx:132), and it opens from every group LessonCard on Dashboard/Schedule. GroupsPage similarly shows an EDITABLE PricePill on group_enrollments.price_per_lesson for the group's tutor (GroupsPage.tsx:1017-1021 → saveEnrollmentPrice at 728-740, direct update). DB policies permit all of it: `tutor_manages_participants` FOR ALL USING (l.tutor_id = auth.uid()) (20260508080932:13-16) and `Tutor manages enrollments of own groups` FOR ALL USING is_group_tutor() (20260506052723:34-38) — no source scoping, no column REVOKE. /groups is in the tutor sidebar nav with no independentOnly flag (AppSidebar.tsx:73). Migrations 20260714000000/20260715000000 closed exactly this for INDIVIDUAL lessons (lesson_details) but not for lesson_participants/group_enrollments; FinancesPage even masks group money client-side for hub tutors (FinancesPage.tsx:284-286), proving the rule — these two surfaces violate it.
- **Чому:** A hub tutor on a hub group sees exactly what each student pays the hub (the hub's revenue; price − payout = margin) and can mark student→hub group debts paid or rewrite the hub's per-student group price — the same P0-class breach of the hub monetization confidentiality that was just remediated for individual lessons, and the writes actually succeed (not no-ops).
- **Фікс:** Mirror 20260714/20260715 for the group tables in a new migration timestamped above 20260718000000: (a) scope the tutor arm of lesson_participants/group_enrollments so student money columns are only readable/writable by the tutor when the parent lesson/group source is 'independent' (e.g. route reads through a definer view that NULLs student_price/status for hub tutors + REVOKE the money columns, and route writes through a guarded RPC like update_lesson_details_safe); (b) in UI, pass canEdit / show prices in GroupLessonParticipants and GroupsPage PricePill only for managers and independent owners. Verify with a hub-tutor anon-key probe that lesson_participants?select=student_price returns denied/null and the update is rejected.

---

### flow: mark-lesson-done celebration / MON-2
*роль:* hub-tutor · *файл:* `src/pages/DashboardPage.tsx:610-624, 658-714 (+ src/pages/SchedulePage.tsx:811-822, 830-858)` · *статус:* ⏳

- **Що:** When a hub tutor marks their lesson completed from a LessonCard status dropdown, the celebration toast asks «Учень оплатив?» with an «Оплачено» action. canMarkPay = `lesson.student_payment_status !== "paid" && (isManager || lesson.tutor_id === user?.id)` — for a hub tutor lessons_visible masks student_payment_status to NULL, so `null !== "paid"` is always true and the question ALWAYS shows. Tapping «Оплачено» calls updatePayment(..., 'student_payment_status', 'paid') → update_lesson_details_safe, which since 20260714000000 SILENTLY IGNORES student money keys for hub tutors (v_student_ok=false, no error): on Dashboard the optimistic setLessons flip (line 671) is never reverted and haptic.success fires for a write that did nothing; on SchedulePage the identical path (812-819) even shows the generic success toast «paymentUpdated» (line 857) for a DB no-op.
- **Чому:** The hub tutor's single most-repeated flow (complete a lesson) asks them about money that belongs to the hub (student→hub payment is the manager's to record — MON-2), and the offered action lies: it buzzes/告 success while the database ignores it, so the tutor believes they recorded a payment that the manager never sees.
- **Фікс:** Gate the toast question and the toast action on `isManager || lesson.source === 'independent'` in DashboardPage.updateStatus (canMarkPay at line 611) and SchedulePage.updateStatus (canMarkPay at 812-813). For hub tutors show only the streak/celebration description. Also make updatePayment refuse student_payment_status writes for hub-source lessons client-side so no other caller can create the same silent no-op.

---

## MED

### group-only student treated as tutor-less (analogue gap of the fixed hub-quiz bug)
*роль:* student · *файл:* `src/hooks/useStudentContext.ts:20-31 (+ StudentDashboardPage.tsx:83,365; ChatsPage.tsx:149-181,344-376)` · *статус:* ⏳

- **Що:** `hasTutor` counts ONLY student_rates rows. A student enrolled by a manager into a GROUP (group_enrollments — GroupsPage.tsx:885 creates no student_rates row; manager candidates are ALL user_roles students, GroupsPage.tsx:833-837) has hasTutor=false. Consequences: (1) on first login they are force-shown the find-a-tutor quiz (StudentDashboardPage.tsx:83 gate `!hasQuiz && !hasTutor`) whose submit creates a phantom tutor_referral_requests row + notifyManagers ping (StudentOnboarding.tsx:107-123) although a manager already matched them; (2) Block 6 «Шукаємо тобі репетитора» renders permanently (line 365); (3) chat is a silent dead-end: the thread bootstrap collects pairs only from lessons.tutor_id/student_id + student_rates (ChatsPage.tsx:152-181) — group lessons have student_id NULL so no thread is created, and the `?with=<tutor>` fallback reads the tutor's user_roles (line 346-349) which returns [] under RLS ('Users view own roles' + manager-only, migration 20260417083348), so tutorId stays null and the handler returns without creating a thread, a toast, or any feedback — the 44px chat button on every group lesson card does nothing.
- **Чому:** This is exactly the class of bug the 2026-07-03 remediation fixed for hub students with rates ('apply fixes to ALL analogues' is a binding process rule): a group-invited student's first session is hijacked by an irrelevant intake quiz, managers get phantom requests, and the student cannot message the tutor they see on every lesson card.
- **Фікс:** 1) hasTutor: also count group links — e.g. `Promise.all([...student_rates…, supabase.from("group_enrollments").select("id",{count:"exact",head:true}).eq("student_id",user.id).eq("status","active")])` and OR the counts. 2) ChatsPage bootstrap: additionally collect pairs from `lesson_participants.select("lesson_id, lessons!inner(tutor_id)").eq("student_id", myId)`. 3) `?with` handler: when the viewer is student-only (`roles` are known locally), skip the RLS-blocked user_roles lookup and call get_or_create_chat_thread with `_tutor_id: withId, _student_id: myId` (the RPC itself validates the relationship); at minimum show a toast instead of returning silently.

---

### homework — fresh homework lands in «Архів», default tab empty, count ≠ list
*роль:* student · *файл:* `src/pages/student/StudentHomeworkPage.tsx:168-177, 282-296 (+ StudentDashboardPage.tsx:148-151)` · *статус:* ⏳

- **Що:** The Активні/Архів split is purely by lesson date: `new Date(r.starts_at).getTime() < now ? archive : active` (line 174). Homework is normally written by the tutor on a lesson that already happened, so virtually every NEW to-do homework immediately falls into «Архів» (hint: 'ДЗ з минулих уроків'), while the DEFAULT tab «Активні» (defaultValue="active", line 282) shows the warm empty state «Поки без домашки». Meanwhile the dashboard tile counts ALL not-done homework regardless of lesson date (StudentDashboardPage.tsx:149-151). The code's own comment promises 'Активні = майбутні/нещодавні' but no 'нещодавні' (recent) window exists. Tab counts also include done items, unlike the tile which subtracts them.
- **Чому:** The student taps «Домашні завдання: 2» on the dashboard and lands on a page that says there is no homework — a direct count-vs-list mismatch (audit requirement (d)) on the student's core action loop; the actual to-do items are hidden behind a tab named 'Archive'.
- **Фікс:** Make «Активні» = homework not yet marked done (any lesson date, or lessons within the last ~14 days), «Архів» = done items + older; or at least default the Tabs to whichever tab has undone homework. Align tab counts with the dashboard tile by counting undone items (`!doneSet.has(lesson_id)`).

---

### a11y/design — WCAG-failing #9398b0 (and #b0b4c8) still hardcoded across student surfaces
*роль:* student · *файл:* `src/pages/student/StudentDashboardPage.tsx:200-201 (+ StudentProfilePage.tsx:30; FindTutorDialog.tsx:24; RewardCollection.tsx:13; StudentAchievementsPage.tsx:119,129; StudentAchievementsGrid.tsx:94,111-114,126; StudentSchedulePage.tsx:155)` · *статус:* ⏳

- **Що:** index.css:138-143 explicitly remapped --sub to #6b7088 because '#9398b0 = 2.85:1, fails WCAG AA'. But the student surfaces still hardcode the failing literal in local palettes and inline styles: StudentDashboardPage `DS.sub="#9398b0"` (used for the 15px greeting subtitle, 14px noTutorYet/noLessons text, 14px stat-card labels, tutor line); StudentProfilePage `C.sub` (email 15px, section labels, tutor subjects, privacy/terms links); FindTutorDialog `SUB` (header subtitle 15px, cancel button, suggestion chips); RewardCollection empty text 15px; StudentAchievementsPage section labels; StudentAchievementsGrid unearned badge TITLES (#9398b0, 14px) and criteria text in #b0b4c8 (~2.1:1) at 14px; StudentSchedulePage «Посилання зʼявиться…» line.
- **Чому:** The owner's users have ~80% vision and use the app outdoors in sunlight (binding a11y rule); the remediation fixed this app-wide via the --sub token, but these inline literals bypass the fix, so the student cabinet — the role most likely to include children/low-vision users — keeps sub-AA secondary text, including essential content (how to earn a badge, when the link appears, whom the lesson is with).
- **Фікс:** Replace the hardcoded `#9398b0` in the local DS/C/SUB palette objects and inline styles with `var(--sub,#6b7088)` (as StudentSchedulePage/StudentPaymentsPage already do in most places); in StudentAchievementsGrid use #6b7088 for the unearned title and criteria text (keep #b0b4c8 only for truly decorative elements like the lock icon).

---

### profile — fake «Тижневий рекорд» + double-nested card
*роль:* student · *файл:* `src/pages/student/StudentProfilePage.tsx:194-196 (+ 67-70)` · *статус:* ⏳

- **Що:** The profile passes `weeklyRecord={weekly}` — i.e. the CURRENT week's completed count — where StudentProgressBar expects the all-time weekly record (`🏆 studentRecord.weeklyRecord`). The dashboard computes the true record via ISO-week grouping (StudentDashboardPage.tsx:65-76), so the two surfaces show different 'record' numbers for the same student, and the profile's row disappears entirely any week with 0 lessons (`weeklyRecord > 0` gate) even when a real record exists. Additionally the profile wraps StudentProgressBar — which already renders its own bordered rounded-[18px] white card (StudentProgressBar.tsx:56) — inside ANOTHER bordered rounded-[18px] padded card (line 194), producing a visible card-in-card double border that the dashboard (line 355, rendered bare) doesn't have.
- **Чому:** A gamification stat that changes value between two pages (and can silently vanish) undermines the trust the streak/record mechanic is supposed to build; the double border is a DS conformance defect on the profile page.
- **Фікс:** Extract the dashboard's getISOWeek/byWeek record computation into a small shared helper (e.g. src/lib/studentStats.ts), use it in StudentProfilePage to pass the true record; remove the outer wrapper div at line 194 and render StudentProgressBar bare like the dashboard does.

---

### dashboard bonus tasks
*роль:* independent-tutor · *файл:* `src/pages/DashboardPage.tsx:1066-1073` · *статус:* ⏳

- **Що:** The independent tutor's 🎁 referral bonus task navigates to `to: "/referrals"` — a MANAGER-only route (App.tsx:196-201 wraps ReferralsPage in `allowedRoles={["manager"]}`). ProtectedRoute bounces a non-manager back to "/" (ProtectedRoute.tsx:53-59). The tutor referral page is `/my-referrals` (App.tsx:204).
- **Чому:** Tapping the '🎁 Отримай Pro безкоштовно' card in «Що зробити далі» silently returns the tutor to the same dashboard — a dead loop on the surface that is supposed to drive the referral growth loop; the task also never completes so it keeps reappearing.
- **Фікс:** Change the referral task's `to` from "/referrals" to "/my-referrals" (the manager smart-task at :1141 correctly keeps "/referrals"). Also delete or fix the unused ReferralNudgeBanner (imported at :21, never rendered; its CTA at ReferralNudgeBanner.tsx:64 has the same wrong link) so it can't be re-wired broken.

---

### dashboard bonus tasks → Profile deep link
*роль:* independent-tutor · *файл:* `src/pages/DashboardPage.tsx:1050-1057` · *статус:* ⏳

- **Що:** The 🎥 Zoom bonus task links to `/profile#zoom`, but ProfilePage has no zoom anchor and no zoom sheet: the hash handler's sheetKeys are only ["rules","automark","subjects","calendar","availability"] (ProfilePage.tsx:166) and `grep id="zoom"` across src returns nothing — ProfilePage has no meeting-link setting at all (per-student links live only in MyStudentsPage's edit form).
- **Чому:** The tutor taps 'add your Zoom link', lands at the top of their profile, and finds no Zoom setting anywhere on the page — a hard dead-end for a core setup action (the lesson-card Video button depends on it), compounding the broken ZoomBonus above; the footer hint «Підключиш у профілі» makes the same false promise.
- **Фікс:** Either add a meeting-link row/sheet to ProfilePage (id="zoom", add "zoom" to sheetKeys) that edits per-student defaults, or point the task somewhere the link can actually be set (e.g. `/my-students` with a hint to edit a student), and align the connectInProfile copy.

---

### add-student quick dialog
*роль:* independent-tutor · *файл:* `src/components/QuickAddStudentDialog.tsx:104-109, 421-436` · *статус:* ⏳

- **Що:** The dialog collects '🔒 приватні нотатки' into form.notes (textarea at :426-435) but never persists them: the add_or_link_independent_student RPC has exactly 8 params (text×6, numeric, text — no notes; migration 20260705000000:107) and no follow-up write to tutor_student_notes exists. MyStudentsPage's identical create flow DOES save notes (MyStudentsPage.tsx:449-456).
- **Чому:** Silent data loss behind a lock icon that promises privacy/persistence: everything the tutor types about the student in the dashboard/FAB add-flow vanishes without any error — and since this dialog is the primary add-student path from the dashboard, first impressions of data reliability suffer.
- **Фікс:** After a successful RPC, mirror MyStudentsPage: `if (form.notes.trim()) await supabase.from("tutor_student_notes").upsert({ tutor_id: user.id, student_id: newId, notes: form.notes.trim() }, { onConflict: "tutor_id,student_id" })`.

---

### WalletsPage (regression from the perf remediation)
*роль:* independent-tutor · *файл:* `src/pages/WalletsPage.tsx:60-65, 101-103` · *статус:* ⏳

- **Що:** The balances query selects only `tutor_id, student_id, lessons_balance, amount_balance` from student_wallet_balances, omitting `last_transaction_at` which the view provides (types.ts:2305) and which the page then reads (`bal?.last_transaction_at ?? null` at :103). It is therefore always null.
- **Чому:** Every wallet row shows «Остання операція: —» (mobile :232, desktop :276) and the 'most recent activity first' sort (:129-131) never fires — the page's recency ordering and last-op column are both dead, so the tutor can't see when a student last topped up. The 4d57a50 waterfall-collapse trimmed the select and dropped the column.
- **Фікс:** Add `last_transaction_at` to the select at :63-64.

---

### money surfaces — own currency (MON-2 for independents)
*роль:* independent-tutor · *файл:* `src/pages/DashboardPage.tsx:1404, 1448 (+ FinancesPage.tsx:1805,1822,1837,1897,1952)` · *статус:* ⏳

- **Що:** The independent profit card renders `formatPrice(profit, "UAH")` on both mobile and desktop, and the whole independent Finances view hardcodes ₴ (received :1805, pending :1822, avg :1837, per-op rows :1897, debt banner :1952) — while the product officially supports 5 rate currencies (SF_A spec, QuickAddStudentDialog.tsx:183-184) and per-pair currency is already loaded (pairCurrency / pairCurrencies). All sums also add USD+EUR+UAH numbers together as if they were one currency.
- **Чому:** A tutor with a $-priced student (the sv/en audience the 3 locales exist for) sees mathematically wrong totals labeled ₴ on the two most important money surfaces — the same defect class the audit confirmed and fixed for RecordPaymentSheet ('must not label USD/EUR students' amounts with a hardcoded ₴', FinancesPage.tsx:205), left unfixed on Dashboard profit and the whole independent Finances view.
- **Фікс:** Group totals by currency (rows already know their pair currency): show the dominant currency's total with a '+ N in other currencies' suffix or one line per currency, and use formatPrice(row.student_price, pairCurrencies[key]) on every row instead of a literal ₴.

---

### MyStudentsPage save flow
*роль:* independent-tutor · *файл:* `src/pages/MyStudentsPage.tsx:432-437, 540-545` · *статус:* ⏳

- **Що:** In both create and edit branches, an invalid meeting URL triggers `toast.error(...); return;` WITHOUT `setSubmitting(false)` — after `setSubmitting(true)` at :385. The save button is `disabled={submitting}` with a spinner (:1131-1138), so it stays permanently disabled. In the create branch this happens AFTER the student was already created via the RPC (:390), so the dialog hangs on a student that already exists.
- **Чому:** Typing e.g. 'zoom.us/j/123' (no scheme survives sanitizeHttpUrl → empty) dead-ends the form: the button spins forever, the tutor can't retry or close-and-understand, and on reopen the 'add' silently becomes a duplicate-link attempt — classic first-session friction in the add-student path.
- **Фікс:** Validate the meeting URL BEFORE setSubmitting(true)/the RPC (alongside the name/contact/price checks at :368-383), or at minimum call setSubmitting(false) before both early returns.

---

### i18n — WalletsPage
*роль:* independent-tutor · *файл:* `src/pages/WalletsPage.tsx:149, 228, 232, 282` · *статус:* ⏳

- **Що:** Four raw Ukrainian UI strings bypass i18n: the page subtitle «Передоплати учнів за майбутні уроки…» (:149), mobile card button «Поповнити» (:228), «Остання операція:» (:232), desktop row button «Відкрити» (:282). check-hardcode passes only because these fit inside the global 50-line debt budget; check-i18n only validates key sync, so gates stay green.
- **Чому:** en/sv users (all three locales are shipped and required to be in sync per the i18n rule 'never use hardcoded UI strings') get a mixed-language Wallets page — including its two action buttons — on a money surface independent tutors use for prepayments.
- **Фікс:** Add walletsPage.* keys to uk/en/sv (subtitle, topUp, lastOp, open) and replace the literals; run check-i18n to confirm sync.

---

### headers — NotificationBell missing on desktop (shell inconsistency)
*роль:* manager + hub tutor + independent tutor (desktop) · *файл:* `src/pages/SchedulePage.tsx:999-1010 (also PeoplePage.tsx:1122-1124, FinancesPage.tsx:1564/2255, WalletsPage.tsx:144-146, ChatsPage.tsx:839-861, MyStudentsPage.tsx:668-675)` · *статус:* ⏳

- **Що:** Six pages render a desktop-only header (`hidden lg:flex`) with NO NotificationBell, while GroupsPage:162, ReferralsPage:178, DashboardPage:1315 and ErrorLogPage:60 do include it. AppLayout's bell header is `lg:hidden` (AppLayout.tsx:53), AppSidebar imports NotificationBell (:55) but never renders it, and ChatsPage.tsx:3 / MyStudentsPage.tsx:5 import it dead — so on lg+ these six pages have zero notification affordance. Spec is explicit: Layout 'every page' header = h1 + 🔔 Bell; SchedulePage 'Bell + burger in header'; PeoplePage 'Header: h1 + bell'; MyStudentsPage 'Bell in header'.
- **Чому:** Desktop users on Schedule/People/Finances/Wallets/Chats/MyStudents cannot see or open notifications without navigating away — new-message and payment pings go unseen exactly on the work pages; cross-page shell inconsistency is a documented audit blind spot the owner flagged.
- **Фікс:** Add `<NotificationBell />` to the right side of each desktop header row: SchedulePage in the shrink-0 controls div (~:1011), PeoplePage inside the justify-between div at :1122, FinancesPage next to both h1 renders (:1564, :2255), WalletsPage in the :144 flex row, MyStudentsPage in the :669 header (import already present), ChatsPage in the list-header (~:846). Remove the dead import in AppSidebar.tsx:55 or render it there instead.

---

### i18n — hardcoded Ukrainian UI strings
*роль:* manager (Wallets, Referrals) — en/sv locales · *файл:* `src/pages/WalletsPage.tsx:149, 216, 228, 232, 282 (+ src/pages/ReferralsPage.tsx:176)` · *статус:* ⏳

- **Що:** Hardcoded Ukrainian in JSX with no t(): WalletsPage subtitle 'Передоплати учнів за майбутні уроки…' (:149), '🎟 N ур.' (:216), button 'Поповнити' (:228), 'Остання операція:' (:232), button 'Відкрити' (:282); ReferralsPage desktop h1 'Запити на репетиторів' (:176) — while the rest of both pages uses keys (walletsPageExtra.*, referralsPageExtra.*). check-hardcode passes only because of its global 50-line allowance.
- **Чому:** CLAUDE.md i18n rule is binding: 'Never use hardcoded UI strings — always i18n keys'. An en/sv manager sees Ukrainian on the wallet primary action and the Referrals desktop title (mobile shows the translated nav.referrals via AppLayout — so desktop and mobile titles even disagree).
- **Фікс:** Add keys to all 3 locales (e.g. walletsPageExtra.subtitle/.lessonsShort/.topUp/.lastOp/.open, referralsPageExtra.pageTitle — reuse nav.referrals for the h1) and replace the literals; re-run check-i18n + check-hardcode.

---

### interactive sizing — touch target below 44px on primary action
*роль:* manager (Wallets) · *файл:* `src/pages/WalletsPage.tsx:224-229 (mobile), 280-283 (desktop)` · *статус:* ⏳

- **Що:** The per-row primary action 'Поповнити' (top-up) on the MOBILE card list is `h-9` = 36px (:225 `rounded-[11px] px-3 h-9`), and the desktop table's row action 'Відкрити' is also `h-9` (:280). The buttons spec mandates h-11/44px minimum ('no h-9 on interactive elements'); the documented exception covers only compact inline controls (view toggles, payment-status selects in card footers) — a card's sole primary CTA is not that.
- **Чому:** 36px top-up button on a phone, used by the owner outdoors, is below the 44px floor the spec calls out as a recurring regression; it is the single action the wallets page exists for.
- **Фікс:** Change both buttons to `h-11` (and bump the desktop one or keep it h-11 for consistency); keep radius per button spec (rounded-[12px]). Verify no layout squeeze in the mobile card row at 360px width.

---

### empty states — negative «Немає/No/Inga» framing (MANDATORY positive rule)
*роль:* manager + tutor + student (uk live; en/sv broader) · *файл:* `src/pages/FinancesPage.tsx:1913, 2538 (+ ChatsPage.tsx:1519, ChatContextPanel.tsx:256, ProfilePage.tsx:479; en.ts:534/2097, sv.ts:244/307/2087)` · *статус:* ⏳

- **Що:** Live empty states still negatively framed despite 'ZERO Немає X patterns': FinancesPage:1913 → finances.noOpsForPeriod 'Немає операцій за цей період' (uk.ts:627); FinancesPage:2538 → finances.noMarginData 'Немає даних: …' (uk.ts:787); ChatsPage:1519 new-chat dialog → chats.noPairs 'Немає активних пар…' (uk.ts:879); ChatContextPanel:256 → chatContext.noUpcoming 'Немає запланованих уроків' (uk.ts:3825); ProfilePage:479 → profile.noExtraSettings 'Немає додаткових налаштувань.' (uk.ts:995). Additionally the positive-framing pass was applied to uk only: en/sv equivalents of table-mandated keys stayed negative — schedule.noUpcoming en.ts:534 'No upcoming lessons' / sv.ts:307 'Inga kommande lektioner' (uk:540 is '☀️ Жодних уроків — можна відпочити!'), dashboard.noLessons sv.ts:244 'Inga inplanerade lektioner' (uk:475 'Поки тихо. Час запланувати урок 📅'), studentPages.noLessons en.ts:2097/sv.ts:2087 negative (uk:2108 '☀️ Поки вільно…').
- **Чому:** CLAUDE.md declares positive framing MANDATORY for empty states; en/sv are first-class locales (check-i18n syncs keys, not tone), so English/Swedish users get exactly the cold copy the owner banned.
- **Фікс:** Rewrite the five uk keys warmly (e.g. noOpsForPeriod → 'Тихий період — жодної операції поки що ✨'; chatContext.noUpcoming → '☀️ Вільний графік — можна запланувати урок'); then sweep en.ts/sv.ts for every key whose uk value was positivized (grep '"No \|Inga ') and align tone in the same pass.

---

### Dashboard smart-task → Schedule flow
*роль:* manager · *файл:* `src/pages/DashboardPage.tsx:933-941 (count); src/pages/SchedulePage.tsx 889-895 + 350-352; src/hooks/useScheduleFilters.ts 25` · *статус:* ⏳

- **Що:** Count ≠ list on the «уроків без посилання» smart task. Dashboard counts only FUTURE `status === "scheduled"` lessons without an effective link (DashboardPage.tsx:933-941: `l.status === "scheduled" && new Date(l.starts_at).getTime() >= nowMs && !effectiveMeetingUrl(l)`). The task links to /schedule?view=list&filter=nolink, but SchedulePage's nolink filter (889-895) keeps every NON-CANCELLED lesson without a link — including completed and past ones — over its −90d..+60d fetch window (SchedulePage.tsx:350-352), with default period "all" (useScheduleFilters.ts:25). Completed past lessons almost never have links, so the landing list is routinely much longer than the count.
- **Чому:** Manager taps 'N уроків без посилання', lands on a list with far more rows (old completed lessons mixed in) and can't tell which N actually need action — the exact count-vs-list mismatch class the owner has repeatedly flagged as a bug. The prior audit's fix aligned the link definition (pair defaults) but not the status/time scope.
- **Фікс:** Make the schedule nolink filter mirror the count: `l.status === "scheduled" && starts_at >= now` in the listFocus === "nolink" branch (SchedulePage.tsx:890-895), or have the deep link also set period=upcoming + status=scheduled. Apply the same status/time scoping to the sibling `unpriced` focus for consistency.

---

### Shell — notifications on desktop (all pages)
*роль:* manager · *файл:* `src/components/AppLayout.tsx:52 (header lg:hidden); bell rendered only in DashboardPage.tsx:1315, GroupsPage.tsx:162, ReferralsPage.tsx:178, ErrorLogPage.tsx:60` · *статус:* ⏳

- **Що:** The golden NotificationBell is unreachable on desktop from most manager pages. AppLayout's title+bell+burger header is `lg:hidden` (AppLayout.tsx:52), and only 4 pages render their own desktop bell (Dashboard `hidden lg:flex`, Groups, Referrals, ErrorLog). People, Schedule, Finances, Chats, Wallets, SubscriptionRequests, Marketing and Availability render NO bell at lg, the sidebar has no notifications entry, and no /notifications route exists (the bell popover is the only notifications UI). ChatsPage.tsx:3, AppSidebar.tsx:55 and MyStudentsPage.tsx:5 even import NotificationBell without rendering it (dead imports).
- **Чому:** Spec: header = h1 + golden bell on EVERY page, 'same style on EVERY page'. A desktop manager working in People/Finances/Chats cannot open or notice notifications at all (unread tutor requests, payout pings) without navigating back to the dashboard — a dead-end for the notification flow and an inconsistent shell.
- **Фікс:** Add the bell to a shared desktop header (e.g., extend AppLayout with a lg header variant, or add `<NotificationBell />` to each page's existing `hidden lg:flex` h1 row like GroupsPage does). Remove the dead imports in ChatsPage/AppSidebar/MyStudentsPage.

---

### SubscriptionRequestsPage + WalletsPage — touch targets
*роль:* manager · *файл:* `src/pages/SubscriptionRequestsPage.tsx:274, 284, 295; also src/pages/WalletsPage.tsx 224-229, 279-283` · *статус:* ⏳

- **Що:** Primary action buttons below the 44px touch floor. SubscriptionRequestsPage's three status actions «Взяти в роботу / Завершити / Відхилити» are all inline `height: 38` (lines 274, 284, 295). WalletsPage's per-card primary action «Поповнити» is `h-9` (36px, lines 224-229) and the desktop row action «Відкрити» is `h-9` (279-283). These are the pages' main CTAs, not the compact view-toggle/status-select exception the spec allows (contrast: WalletDialog's 36-38px buttons ARE tab/mode toggles and are fine).
- **Чому:** Binding DS rule: minimum touch target 44px (h-11) on interactive elements — for users with ~80% vision using the app outdoors. 36-38px money/status CTAs are exactly the mis-taps this rule exists to prevent; inline `height:` styles also slip past check-ux's h-8/h-9 class scan, so the gate stays green.
- **Фікс:** Bump the three SubscriptionRequests action buttons to height 44 (and consider `min-height`), and make Wallets «Поповнити»/«Відкрити» h-11 (44px). Sweep sibling manager pages for other inline sub-44 heights while there.

---

### i18n — Referrals / Wallets / People sheet / SubscriptionRequests
*роль:* manager · *файл:* `src/pages/ReferralsPage.tsx:175-177; also src/pages/WalletsPage.tsx 148-150, 228, 231-233, 282; src/components/ManagerNotes.tsx 95; src/pages/SubscriptionRequestsPage.tsx 190-193` · *статус:* ⏳

- **Що:** Hardcoded Ukrainian on manager surfaces despite the binding 'always i18n keys' rule (none of these files are in check-hardcode's SKIP list — they pass only because of the global 50-string allowance). Evidence: ReferralsPage desktop h1 is literal «Запити на репетиторів» (175-177) even though `referralsPage.title` exists (uk.ts:2567); WalletsPage subtitle «Передоплати учнів…» (148-150), button «Поповнити» (228), «Остання операція:» (231-233), «Відкрити» (282); ManagerNotes.tsx:95 hardcodes «Приватні нотатки» and then extracts the count via `t("managerNotesExtra.titleWithCount").replace("Приватні нотатки (", "").replace(")", "")` — in en/sv the replace doesn't match, producing «Приватні нотатки Private notes (2)»; SubscriptionRequestsPage renders «₴/міс» and formats dates with a hardcoded date-fns `uk` locale (190-193) regardless of language.
- **Чому:** en/sv managers get mixed-language or garbled UI on Referrals, Wallets, the People person-sheet notes row, and Subscription requests — the same class the audit already remediated for SubscriptionRequests, so these are residuals/regressions of that pass; the ManagerNotes string-replace hack is outright broken output in non-uk locales.
- **Фікс:** Use `t("referralsPage.title")` for the h1; add walletsPage keys for the four Wallets strings; give ManagerNotes a proper `titleWithCount`/`title` key pair (no string surgery); add a perMonth i18n key and pass `getLocale()`-based date-fns locale in SubscriptionRequestsPage. Sync uk/en/sv and re-run check-i18n + check-hardcode.

---

### ReferralsPage + WalletsPage — loading state
*роль:* manager · *файл:* `src/pages/ReferralsPage.tsx:181-184; also src/pages/WalletsPage.tsx 184-187` · *статус:* ⏳

- **Що:** Both pages show a centered `<Loader2 className="h-6 w-6 animate-spin" />` for the whole content area while loading (ReferralsPage.tsx:181-184, WalletsPage.tsx:184-187), while every other manager page uses PageSkeletons (PeopleSkeleton, GroupsSkeleton, ChatsSkeleton, FinancesSkeleton, ScheduleSkeleton, DashboardSkeleton) and even SubscriptionRequestsPage builds inline card skeletons (144-160).
- **Чому:** Spec: 'Replace ALL Loader2 animate-spin full-page spinners with skeletons' (Loader2 is reserved for inline submit buttons). The two odd-ones-out make the shell feel inconsistent and the pages feel slower — the referral queue is a priority manager flow reached straight from the dashboard smart-task.
- **Фікс:** Add a ReferralsSkeleton and WalletsSkeleton to PageSkeletons.tsx (list-of-cards / table-row shapes) and render them in place of the two Loader2 blocks.

---

### Journey 3 — tutor request → assignment
*роль:* student · *файл:* `src/components/AssignTutorDialog.tsx (+ src/components/FindTutorDialog.tsx, src/pages/student/StudentDashboardPage.tsx):AssignTutorDialog.tsx:149-244; FindTutorDialog.tsx:86-119; StudentDashboardPage.tsx:229, 365` · *статус:* ⏳

- **Що:** Tutor assignment is silent and the pending request is invisible to the student. handleAssign writes student_rates, marks the request fulfilled with a student-safe manager_response, and creates a chat thread — but sends NO notification to the student (and none to the assigned tutor); the file doesn't import notifications at all. Migration 20260702000000 added RLS so students can read their own tutor_referral_requests, yet no student surface consumes it (grep: only AssignTutorDialog/ReferralsPage/DashboardPage read the table). Meanwhile the dashboard's no-tutor CTA is gated only on !hasTutor (StudentDashboardPage.tsx:229/365), so after submitting a request the student still sees the same «Знайти репетитора» call-to-action, and FindTutorDialog has no existing-request check — inviting duplicate requests that spam the manager's /referrals queue.
- **Чому:** Between «request sent» and «tutor assigned» the student is in a void: no 'we're on it' state, no bell when matched, no way to see the manager's response. The most likely reactions are re-submitting the quiz/dialog (duplicate smart-tasks for the manager) or churning before discovering they were matched. The tutor likewise learns about the new student only if they stumble on the chat thread.
- **Фікс:** In handleAssign: insertNotification to request.student_id (type `tutor_assigned_${request.id}`, title with tutor name + subject, link '/student-dashboard') and to tutorId (new student assigned, link '/chats'). On the student dashboard, when !hasTutor but an open/in_progress own tutor_referral_request exists, replace the CTA with a «Запит надіслано — підбираємо репетитора ✨» pending chip and block duplicate submissions in FindTutorDialog.

---

### Journeys 1/3 — lesson lifecycle notifications
*роль:* student · *файл:* `src/pages/SchedulePage.tsx:736-799 (createLesson), 801-828 (updateStatus), 862-878 (deleteLesson)` · *статус:* ⏳

- **Що:** The canonical SchedulePage never notifies the individual student about their lesson's lifecycle, while every sibling path does. createLesson inserts lessons + details + Google-sync + toast but has no insertNotification (contrast QuickLessonDialog.tsx:288-303 which notifies the student on create); updateStatus notifies ONLY group participants on cancel (:824-826) — an individual lesson cancelled here sends nothing (contrast DashboardPage.tsx:643-655 which sends 'lesson_cancelled' with link '/student/schedule'); deleteLesson likewise notifies group participants only (:865-867) — an individual student's lesson silently vanishes from their schedule.
- **Чому:** For journey 1/3 the manager's most common flow is SchedulePage: the newly-assigned hub student never gets a «перший урок заплановано» ping (they must discover it by opening the app), and a cancellation done from Schedule (rather than Dashboard) reaches the student only if a Telegram/push pre-lesson reminder later fires — or never. Whether a student is informed depends on WHICH page the manager happened to use, which is exactly the cross-surface inconsistency class the owner flags.
- **Фікс:** Mirror the existing patterns: in createLesson notify form.student_id per inserted lesson (reuse QuickLessonDialog's `lesson_scheduled_${id}` type + copy); in updateStatus add the DashboardPage 'lesson_cancelled' insertNotification for the individual (lsn.student_id) branch; in deleteLesson notify the individual student before delete, as is already done for groups.

---

### Journeys 3/4 — notification dedup
*роль:* manager + tutor · *файл:* `supabase/migrations/20260622000000_referral_and_notification_hardening.sql:126-137 (create_notification dedup)` · *статус:* ⏳

- **Що:** create_notification dedups on (user_id, type) within 24h regardless of title/body/entity: «Dedup: skip if the same user+type was notified within the last 24 hours» — it silently returns the existing id and the push trigger never fires. All request flows use FIXED types: FindTutorDialog.tsx:112 and StudentOnboarding.tsx:119 send type 'tutor_request' to every manager; StudentLessonActions.tsx:117/:149 sends type 'lesson_request' to the tutor for both cancel and reschedule. So when student B files a tutor request 3 hours after student A, the manager gets NO bell and NO push for B; when a second student asks to reschedule the same day, the tutor's bell stays silent. That this is a live hazard is proven in-repo: QuickLessonDialog deliberately works around it with per-entity types — `lesson_scheduled_${created.id}` (QuickLessonDialog.tsx:297) and `cancellation_rules_${created.id}` (:332).
- **Чому:** Distinct business events from different people are swallowed as «duplicates». A busy hub manager relying on the golden bell will miss every tutor request after the first each day (the dashboard smart-task count is the only fallback), and tutors miss same-day change requests — direct baton drops in journeys 3 and 4.
- **Фікс:** Ship a migration (timestamped above the current high-water mark, per the ordering trap) narrowing the dedup key — e.g. skip only when user_id+type+title (or type carrying an entity id) matched in 24h — and/or switch the fixed-type callers to per-entity types (`tutor_request_${requestId}`, `lesson_request_${changeRequestId}`) like QuickLessonDialog already does. Note: DB function change requires Lovable to apply.

---

### Journey 4 — Google Calendar sync
*роль:* tutor · *файл:* `src/components/TutorChangeRequestsCard.tsx (+ src/pages/DashboardPage.tsx):TutorChangeRequestsCard.tsx:192-231 (no sync call in approve); call-site inventory: SchedulePage.tsx:778/827/876, QuickLessonDialog.tsx:242/288` · *статус:* ⏳

- **Що:** Approving a reschedule/cancel skips Google Calendar sync. Grep of syncLessonToGoogleCalendar shows exactly five call sites — SchedulePage create/status/delete and QuickLessonDialog create — but TutorChangeRequestsCard.approve, which rewrites lessons.starts_at (:221-231) or sets status='cancelled' (:192-195), never imports or calls it. DashboardPage.updateStatus (cancel from the dashboard card) also lacks the 'delete' sync.
- **Чому:** A tutor who connected Google Calendar (GoogleCalendarCard promises «Уроки автоматично з'являтимуться у вашому Google Календарі») approves a student's move from Tue 17:00 to Wed 18:00 — their Google Calendar keeps the Tuesday event and never gains the Wednesday one. The tutor trusts the calendar, shows up at the wrong time or double-books the freed slot: a concrete missed-lesson risk created by the app's own approved action.
- **Фікс:** In approve(): after the successful lessons.update, call void syncLessonToGoogleCalendar(lesson.id, active.kind === 'cancel' ? 'delete' : 'upsert') — same fire-and-forget pattern as SchedulePage.updateStatus:827. Add the same 'delete' call in DashboardPage.updateStatus's cancelled branch.

---

### Journey 1 — payout marking
*роль:* hub-tutor · *файл:* `src/pages/DashboardPage.tsx (+ src/pages/FinancesPage.tsx, migration 20260613094953):DashboardPage.tsx:833-849 (markPayoutPaid — no notification) vs :705-712 (per-lesson toggle — sends payout_confirmed); FinancesPage.tsx:10 (insertNotification imported, zero call sites)` · *статус:* ⏳

- **Що:** The hub tutor is told «you've been paid» on only one of the three payout-marking paths. DashboardPage.updatePayment's per-lesson tutor_payout toggle sends the 'payout_confirmed' bell (:705-712, the only 'payout_confirmed' producer in the codebase per grep). But the payout-schedule smart-task path — markPayoutPaid → RPC mark_tutor_payouts_paid (migration 20260613094953 contains no create_notification) — marks ALL of a tutor's unpaid payouts with no notification; and FinancesPage.togglePayment/bulk actions import insertNotification (line 10) yet never call it — a dead import evidencing the dropped wire.
- **Чому:** Journey 1's final beat (hub pays tutor) reaches the tutor only if the manager uses one specific per-card toggle on the dashboard. Managers acting on the payout-day smart task — the flow PayoutScheduleCard is built around — pay the tutor silently; the tutor keeps seeing stale «очікує виплати» expectations until they manually open Finances, undermining trust in the payout schedule feature.
- **Фікс:** After a successful mark_tutor_payouts_paid in markPayoutPaid, insertNotification to tutorId (type `payout_confirmed_${todayISO}`, title with the summed amount/count, link '/finances'); do the same in FinancesPage's payout-side togglePayment/bulk handler (the import is already there). Alternatively add the notification inside the RPC itself so all callers inherit it (requires Lovable apply).

---

### flow: close-day batch / MON-2
*роль:* hub-tutor · *файл:* `src/components/CloseDayDialog.tsx:65-71, 83-88, 147-156 (+ src/pages/DashboardPage.tsx:781-801, 1371-1390)` · *статус:* ⏳

- **Що:** The «Закрити день» button is not role-gated (DashboardPage:1371 renders whenever closeDayRows.length > 0, and closeDayRows include the hub tutor's own past lessons). For a hub tutor each row shows `formatPrice(r.price)` where price = Number(masked-NULL student_price) = «0 ₴» (DashboardPage:796, CloseDayDialog:148), and the gold «₴» paid pill is initialized ON for every row (CloseDayDialog:68 `paid: true`). Apply() then fires updateLessonDetailsSafe(..., {student_payment_status:'paid'}) for every row (lines 83-88), which the guarded RPC silently ignores for hub tutors — followed by confetti and a success toast.
- **Чому:** The hub tutor's evening ritual displays bogus 0 ₴ student prices and a default-on student-payment control for money that is the hub's (MON-2), and 'confirms' payment writes that never happen — silently corrupting the tutor's mental model of what the manager has recorded.
- **Фікс:** For hub tutors (lesson.source === 'hub'), hide the price line and the «₴» pill in CloseDayDialog rows (or pass a `showPay:false` per row from DashboardPage based on source) and skip the student_payment_status write in apply(); keep only the «Проведено» batch-complete. Managers/independent tutors unchanged.

---

### payout visibility / UX
*роль:* hub-tutor · *файл:* `src/pages/DashboardPage.tsx:2164-2170 (+ src/components/LessonCard.tsx:327-329; supabase/migrations/20260620141443...sql:24-27)` · *статус:* ⏳

- **Що:** Dashboard lesson cards pass `showPayout={isManager || lesson.source === "hub"}` AND wire `onPayChange` unconditionally for the lesson's tutor (line 2170). LessonCard then renders the 💼 payout row as a TAPPABLE button (`onToggle={() => onPayChange("tutor", !tPaid)}`, LessonCard.tsx:328-329). For a hub tutor the tap runs updatePayment → optimistic flip + haptic.success (lines 671-673) → `set_lesson_tutor_payout_status`, which is manager-only and RAISES 'Only managers can set tutor payout status' (20260620141443:24-27) → revert + haptic.error + «Не вдалося оновити оплату».
- **Чому:** The hub tutor's own payout chip («До виплати») looks and behaves like a control, gives a success buzz, then always fails with an error toast — a guaranteed-broken affordance on the most-viewed card, and it teaches the tutor that the app is flaky.
- **Фікс:** In DashboardPage pass onPayChange only when `isManager || lesson.source === 'independent'` (or split: wire only the 'student' side for independent owners, only manager for payout). The hub tutor's 💼 row should render as the read-only <div> variant (LessonCard already does this when onToggle is undefined).

---

### flow: create lesson (empty state) / parity
*роль:* hub-tutor · *файл:* `src/pages/DashboardPage.tsx:2098-2107 (+ src/components/QuickLessonDialog.tsx:106-118, 231; contrast with the correct hub FAB at DashboardPage:2406-2410)` · *статус:* ⏳

- **Що:** The zero-upcoming-lessons empty state shows «Створити урок» for every non-manager tutor (`isTutor && !isManager`) and opens QuickLessonDialog — the independent-only quick dialog whose student picker reads `student_rates ... .eq("source", "independent")` (QuickLessonDialog.tsx:111), i.e. ALWAYS EMPTY for a hub tutor → submit dead-ends with «addStudentFirst». Worse, the dialog also lists the tutor's lesson_groups (line 112-116) — a hub tutor's HUB groups — and its group mode creates the lesson with hard-coded `source: "independent"` (line 231), producing a mis-sourced group lesson the manager can no longer see (managers are hub/NULL-scoped). The code comment at 2406-2409 documents exactly this hazard and routes the FAB to /schedule?create=1 — but this empty-state CTA was missed.
- **Чому:** A brand-new hub tutor with zero lessons — the exact user this empty state exists for — taps the only visible CTA and hits an empty picker / dead end; if they discover the group tab they silently punch a hole in hub↔independent isolation.
- **Фікс:** Make the CTA role-aware like the FAB: for hub tutors `onClick={() => navigate("/schedule?create=1")}` (the canonical schedule form reads hub students and sets source:'hub'); keep setQuickLessonOpen(true) only for isIndependentTutor. Also make QuickLessonDialog's group path derive source from useWorkspaceSettings instead of hard-coding 'independent'.

---

### MON-2: subscription upsell leak / streak surface
*роль:* hub-tutor · *файл:* `src/components/StreakCard.tsx:72-81 (+ src/i18n/locales/uk.ts:1356-1359; rendered for hub tutors at src/pages/DashboardPage.tsx:2389-2393 and src/pages/AchievementsPage.tsx:53)` · *статус:* ⏳

- **Що:** The StreakCard — now rendered for hub tutors on Dashboard (parity fix) and AchievementsPage — shows «🎁 Ще N днів — і отримаєш +1 місяць підписки безкоштовно!» at streak 16-29 and «🏆 Чудова серія! Ти отримав +1 місяць підписки.» at 30+ (uk.ts:1356-1359) with no role gating. Subscription/Pro months are an independent-tutor-only concept (MON-2); the 30-day grant (update_tutor_streak → grant_pro_days, 20260430074614:419-422) extends trial_until, which a hub tutor never uses — their dashboard simultaneously shows «Pro активний — від хабу. Платити не треба».
- **Чому:** A hub-tutor surface now advertises the independent subscription and promises a reward («+1 місяць підписки») that is meaningless to them — contradicting the «Платити не треба» chip a few cards above and violating the no-subscription-upsell rule for hub tutors.
- **Фікс:** Make the bonus lines role-aware: accept an `isHub` prop (or read useWorkspaceSettings inside StreakCard) and for hub tutors hide the daysToBonus/bonusEarned rows or swap in hub-appropriate copy (e.g. pure streak encouragement). Keep independent behavior unchanged.

---

### correctness + i18n (Achievements surface, affects all tutors)
*роль:* hub-tutor · *файл:* `src/components/MonthlySummaryCard.tsx:12-14, 38, 87-88 (+ hardcoded strings at 101-103, 110)` · *статус:* ⏳

- **Що:** `const MONTH_NAMES = [t("months").split(",")]` builds a ONE-element array (an array containing the 12-month array), then `MONTH_NAMES[month - 1]` is used as the month label (line 38). For every month except January this is `undefined` (and for January it interpolates the whole joined list), so the greeting on AchievementsPage renders «...у undefined» in the card and in the share text. Additionally «Поділитись» (line 110) and «🏆 Топ-{N}% репетиторів» (line 101-102 + shareText line 39) are hardcoded Ukrainian, violating the i18n rule (en/sv users see Ukrainian).
- **Чому:** The monthly recap card — a shareable marketing artifact rendered for every tutor incl. hub tutors on /achievements — displays literal 'undefined' as the month 11 months of the year, which is exactly the kind of sloppy output the owner flags; the hardcoded strings leak Ukrainian into en/sv.
- **Фікс:** Change to `const MONTH_NAMES = t("months").split(",")` (and compute inside the component so language switches apply, replacing the module-level bound t). Replace «Поділитись» and the «Топ-N%» pill/share text with i18n keys added to uk/en/sv (keep check-i18n green).

---

## LOW

### dashboard — hasTutor counts archived student_rates
*роль:* student · *файл:* `src/hooks/useStudentContext.ts:25-28` · *статус:* ⏳

- **Що:** hasTutor counts student_rates rows with `.eq("student_id", user.id)` and no `archived_at` filter, while StudentProfilePage's «Мої репетитори» list filters `.is("archived_at", null)` (StudentProfilePage.tsx:58). A student whose only tutor relationship was archived (tutor/manager archived the pair) keeps hasTutor=true.
- **Чому:** Such a student sees NO tutors on their profile and no upcoming lessons, yet the dashboard never offers the «Знайти репетитора» CTA/Block 6 (both gated on !hasTutor) — the one action that would get them a new tutor. Inconsistent state across two student surfaces.
- **Фікс:** Add `.is("archived_at", null)` to the student_rates count in useStudentContext.refresh (mirroring StudentProfilePage), and pair it with the group-enrollment OR from the group-only finding so hasTutor means 'has an active teaching relationship'.

---

### payments/review — touch targets below the 44px floor on core actions
*роль:* student · *файл:* `src/pages/student/StudentPaymentsPage.tsx:259-268, 296-307 (+ ReviewPromptCard.tsx:163-170)` · *статус:* ⏳

- **Що:** The «копіювати реквізити» buttons — the page's primary pay action per the remediation ('copy-реквізити') — are `h-9 w-9` (36px) both in the «Як оплатити» card (line 264) and on each debt row (line 302), below the binding 44px minimum touch target (CLAUDE.md Buttons: 'Minimum touch target: 44px (h-11) everywhere'; the documented exception covers view toggles/status selects, not a row's only action). ReviewPromptCard's skip/dismiss button is 30x30px (line 167).
- **Чому:** Students pay from a phone, often outdoors; a 36px hit area on the single control that completes the pay flow (and a 30px dismiss on the review card) causes missed taps for exactly the low-vision audience the 44px rule protects.
- **Фікс:** Bump the two copy buttons to `h-11 w-11` (icon can stay h-4/w-4) and the ReviewPromptCard close button to 44x44 (visually small icon, padded hit area). Keep the row layout by letting the price/status pill shrink via min-w-0.

---

### DS — skeleton loading
*роль:* independent-tutor · *файл:* `src/pages/WalletsPage.tsx:184-187 (+ SubscriptionPage.tsx:252-259)` · *статус:* ⏳

- **Що:** Both WalletsPage and SubscriptionPage render a full-page centered `Loader2 animate-spin` while loading, contradicting the binding DS rule 'Replace ALL Loader2 animate-spin full-page spinners with skeletons' (CLAUDE.md Skeleton Loading; MyReferralsPage already does the pulse-skeleton correctly at MyReferralsPage.tsx:217-222).
- **Чому:** Inconsistent shell/loading feel across the independent tutor's pages — the two subscription/prepay money pages flash a bare spinner where every other page shows content-shaped skeletons, which reads as unfinished against the rest of the app.
- **Фікс:** Replace the spinner blocks with lightweight pulse skeletons (3 rounded-card placeholders like MyReferralsPage's) or add Wallets/Subscription variants to PageSkeletons.tsx.

---

### onboarding — currency honesty
*роль:* independent-tutor · *файл:* `src/components/OnboardingFlowB.tsx:271-276, 317-322` · *статус:* ⏳

- **Що:** StudentAction hardcodes `_currency: "UAH"` in the add_or_link RPC call and renders a fixed «₴» prefix on the price input, with no currency choice — while the canonical add-student forms (QuickAddStudentDialog :183-186, MyStudentsPage) offer the 5 SF_A currencies and student_rates stores per-pair currency.
- **Чому:** A Swedish/EU tutor (the sv locale audience) onboarding their first student enters '500' next to a ₴ sign and gets a 500-UAH rate stored; every later surface then shows the wrong currency for their very first student until they notice and re-edit — undermining the '(c) own currency' guarantee right at signup.
- **Фікс:** Add the same compact currency picker (or at least default the currency from i18n locale: sv→SEK, en→EUR/USD) and pass it as _currency; show the chosen symbol instead of the hardcoded ₴.

---

### loading — full-page Loader2 spinner instead of skeleton
*роль:* manager + independent tutor · *файл:* `src/pages/ReferralsPage.tsx:181-184 (+ WalletsPage.tsx:185-187, SubscriptionPage.tsx:255-257)` · *статус:* ⏳

- **Що:** Three in-app pages still render a centered `Loader2 animate-spin` as the whole-page loading state: ReferralsPage:182-184, WalletsPage:185-187, SubscriptionPage:255-257 — while the spec says 'Replace ALL Loader2 full-page spinners with skeletons' (inline/submit spinners stay). Comparable pages (Groups→GroupsSkeleton, People→PeopleSkeleton) already conform.
- **Чому:** A blank page with a spinner is the exact perceived-slowness pattern the skeleton rule exists to kill; managers open Wallets/Referrals daily.
- **Фікс:** Add lightweight skeletons to PageSkeletons.tsx (a card-list skeleton covers Referrals and Wallets; a two-card skeleton for Subscription) and swap the three spinner blocks. JoinPage/Index root-gate spinners are pre-auth route gates and can stay.

---

### interactive sizing — 32px edit-profile buttons
*роль:* all roles (own profile) · *файл:* `src/pages/ProfilePage.tsx:445-450, 565-571` · *статус:* ⏳

- **Що:** The pencil 'edit profile' buttons in both profile-header cards are `w-8 h-8` (32px) with a 14px icon (:446 and :568 `className="w-8 h-8 rounded-full …"` onClick={openEditProfile}).
- **Чому:** This is the only affordance for editing your own identity/contacts and sits well under the 44px touch minimum; it is not a documented compact-control exception (not a view toggle or card-footer payment select).
- **Фікс:** Bump both to `h-11 w-11` (icon 16-18px) — the header rows have room; or keep 40px visual with an expanded hit area (`before:absolute before:-inset-1.5`) if the owner prefers the small look.

---

### radii — card containers below the rounded-[16px] standard
*роль:* manager + tutor · *файл:* `src/components/NeedsMarkingCard.tsx:70, 88 (+ src/components/LessonWorkspace.tsx:691, 725, 760, 876)` · *статус:* ⏳

- **Що:** NeedsMarkingCard's outer card is `rounded-xl` (12px, :70 `rounded-xl border border-warning/40 bg-warning/5 p-4`) and its bordered `bg-card` lesson rows are `rounded-lg` (8px, :88); LessonWorkspace renders four full section cards as `rounded-lg border border-border bg-background/50 p-4` (:691, :725, :760, :876). Spec: cards are `rounded-[16px]` — 'never rounded-lg' (ui/card.tsx itself already conforms at 16px).
- **Чому:** NeedsMarkingCard sits in the spec'd Dashboard flow between the notes card and lessons, so its tighter radius visibly breaks the card rhythm next to rounded-[16px] siblings; same for the lesson-workspace sections inside the details dialog.
- **Фікс:** Change :70 to `rounded-[16px]`; the inner rows (:88) and LessonWorkspace sections to `rounded-[16px]` (or at minimum `rounded-[14px]` if a nested step-down is wanted — but pick one and apply to all four LessonWorkspace sections + TutorChangeRequestsCard's analogous rows in the same pass, per the all-analogues rule).

---

### GroupsPage — group details sheet a11y
*роль:* manager · *файл:* `src/pages/GroupsPage.tsx:1022-1029` · *статус:* ⏳

- **Що:** The remove-member trash button's aria-label is `t("groupsPageExtra.studentRemoved")` — the past-tense success-toast string («Учня видалено», same key used for the toast at line 938) — instead of an action label like «Видалити учня з групи».
- **Чому:** A screen-reader manager hears 'student removed' on a button that hasn't been pressed yet — announcing a destructive action as already done invites accidental removals; it also breaks the audit's own aria-label remediation standard.
- **Фікс:** Add a dedicated key (e.g., groupsPageExtra.removeStudentAria = «Видалити учня з групи») to uk/en/sv and use it as the aria-label at line 1025, keeping studentRemoved for the toast only.

---

### ReferralsPage — open-requests banner
*роль:* manager · *файл:* `src/pages/ReferralsPage.tsx:194-203` · *статус:* ⏳

- **Що:** The dark «нові запити» banner renders a right-pointing ChevronRight (line 201) styled exactly like the app's tappable rows, but it is a plain `<div>` with no onClick/role — tapping it does nothing (the first open request is auto-expanded separately at line 134).
- **Чому:** A chevron is the app-wide 'this navigates' affordance (smart tasks, stat cards all use it); a dead one on the priority queue makes the manager tap repeatedly and doubt whether the page is broken.
- **Фікс:** Either make the banner a button that scrolls to / expands the first `status === "open"` request (setOpenId + scrollIntoView), or drop the ChevronRight so it reads as a passive summary.

---

### Journey 4 / i18n — cancel-reschedule dialogs
*роль:* student + tutor · *файл:* `src/components/StudentLessonActions.tsx (+ src/components/TutorChangeRequestsCard.tsx):StudentLessonActions.tsx:190-193, 208, 216, 229-231, 258, 261; TutorChangeRequestsCard.tsx:300, 303, 341, 356, 484, 513` · *статус:* ⏳

- **Що:** The core cancel/reschedule dialogs ship raw hardcoded Ukrainian mixed with t() calls: the student's cancel dialog body («Урок {дата}. Репетитор підтвердить ваш запит… може нарахувати оплату…»), both dialog footers («Закрити», «Надіслати запит»), and the tutor card's header («Запити від учнів», «Скасування та перенесення уроків — підтвердіть або відхиліть»), row label («Урок:»), buttons «Розглянути»/«Відхилити», and «Учень запропонував:». Neither file is in check-hardcode's SKIP_FILES; they pass only because MAX_GLOBAL=50 tolerates a budget. These specific components were NOT among the audit's flagged i18n files (Dashboard/Telegram/GoogleCalendar/SubscriptionRequests) and are distinct from the deferred module-level-t item — these are missing keys, not stale bindings.
- **Чому:** An en/sv student hits the fee-warning text — the single most consequential sentence in the flow (it explains they may be charged) — in Ukrainian only; en/sv tutors get a half-translated triage card. The 3-locale sync rule is a project-level invariant.
- **Фікс:** Extract the ~12 literals to studentLessonActionsExtra.* / tutorChangeRequestsExtra.* keys in uk/en/sv (keys for the dialog descriptions already exist in those namespaces — extend them), replace inline strings with t(), and run check-i18n; consider lowering MAX_GLOBAL after the sweep.

---

### Journey 5 — notification deep-links
*роль:* student · *файл:* `supabase/functions/lesson-reminders/index.ts (+ src/components/QuickLessonDialog.tsx):lesson-reminders/index.ts:183 (feedback nudge), 315 (student pre-lesson reminder); QuickLessonDialog.tsx:302, 335` · *статус:* ⏳

- **Що:** Student-targeted push/bell links point at the legacy shared '/schedule' instead of the student cabinet '/student/schedule'. The post-lesson «⭐ Як пройшов урок?» web-push and the student's «урок через N хв» reminder both send link:'/schedule' (recipient_role:'student'); QuickLessonDialog's lesson-scheduled and cancellation-rules notifications to students do the same. The app's own canonical pattern is DashboardPage.tsx:649 which correctly deep-links students to '/student/schedule'. '/schedule' does render for students (SchedulePage has a pure-student mode), so it's not a 404 — but it's the tutor-styled page outside the student cabinet, and the review nudge lands the student two taps away from the rating UI (ReviewPromptCard lives on /student-dashboard; on /schedule they must find and open the completed lesson's dialog).
- **Чому:** The deep link is the payoff of the whole notification: students following the review nudge land on a page that doesn't visibly offer rating, and reminder taps drop them outside their designed cabinet — friction exactly where the product tries to drive reviews and punctual joins.
- **Фікс:** In lesson-reminders, use link '/student-dashboard' for the feedback nudge (where ReviewPromptCard renders) and '/student/schedule' for the student pre-lesson reminder (keep '/schedule' for the tutor copies); switch QuickLessonDialog's two student notifications to '/student/schedule'. Note lesson-reminders is an edge function — needs Lovable redeploy, not just Publish.

---

### parity: payout visibility on Schedule
*роль:* hub-tutor · *файл:* `src/pages/SchedulePage.tsx:1703-1746` · *статус:* ⏳

- **Що:** SchedulePage LessonCards pass no `showPayout` prop at all, so for a hub tutor `withPayout=false` and student_price is masked NULL → the card renders NO money rows. The Dashboard deliberately shows the read-intent 💼 payout row for hub lessons (`showPayout={isManager || lesson.source === "hub"}`, DashboardPage:2164), so the same lesson shows its payout on one page and nothing on the other.
- **Чому:** A hub tutor checking their schedule cannot see per-lesson payout amount/status (their one legitimate money signal), while the dashboard shows it — inconsistent mental model between the two lesson lists that share the same card component.
- **Фікс:** Pass `showPayout={isManager || (isTutor && lesson.tutor_id === user?.id && lesson.source === "hub")}` on SchedulePage's LessonCard (read-only for hub tutors per the finding about onPayChange), matching the Dashboard.

---

### design system: duplicate element
*роль:* hub-tutor · *файл:* `src/pages/DashboardPage.tsx:1676-1688 and 1722-1728` · *статус:* ⏳

- **Що:** On mobile the hub block renders the violet «Хаб «oTutorHub»» chip TWICE within one screen: once standalone at the top of the block (lines 1676-1688, no responsive gating) and again inside the dark payout card header (lines 1722-1728, inside the `lg:hidden` grid). Both are built from the same `hubTutor.hubChip` string and GraduationCap icon.
- **Чому:** Two identical badges stacked ~60px apart read as a rendering bug and waste the small-screen real estate the 13px-floor rule is protecting; on desktop only one shows, so mobile is the odd one out.
- **Фікс:** Keep one: either drop the standalone chip on mobile (add `hidden lg:flex` to the wrapper at 1676) or remove the in-card copy at 1722-1728.

---

### i18n: pluralization
*роль:* hub-tutor · *файл:* `src/i18n/locales/uk.ts:1663 (+ en.ts:1653, sv.ts:1643)` · *статус:* ⏳

- **Що:** `hubTutor.payoutLessonsChip: "{{count}} уроків"` has no _one/_few/_many plural forms, so the payout-card chip renders «1 уроків», «2 уроків», «3 уроків» (grammatically wrong for 1-4 in Ukrainian); en shows «1 lessons», sv «1 lektioner».
- **Чому:** The chip sits on the hub tutor's hero money card — the first thing they read every day; broken grammar on the flagship card undercuts the polished hub cabinet the redesign built.
- **Фікс:** Add plural forms in all three locales (uk: payoutLessonsChip_one "{{count}} урок", _few "{{count}} уроки", _many "{{count}} уроків"; en: _one "{{count}} lesson", _other "{{count}} lessons"; sv: _one "{{count}} lektion", _other "{{count}} lektioner") and keep check-i18n green.

---

### MON-2: referral side effect before redirect
*роль:* hub-tutor · *файл:* `src/pages/MyReferralsPage.tsx:92-136 (guard at 77, redirect at 201)` · *статус:* ⏳

- **Що:** The redirect for non-independent users happens only at render (`if (blockedNonIndependent) return <Navigate to="/" .../>`, line 201) and blockedNonIndependent stays false while wsLoading — but the data useEffect (keyed only on user?.id, lines 92-136) fires immediately on mount: for a hub tutor deep-linking to /my-referrals it calls `generate_referral_code` (line 103), CREATING a referral_codes row for a hub tutor, plus fetches the leaderboard, before the redirect kicks in.
- **Чому:** A role that must never participate in the independent referral program gets a live referral code minted in the DB just by touching the URL — polluting referral data (leaderboard/purge surface the audit just cleaned) even though no UI is shown.
- **Фікс:** Gate the effect: `if (!user || wsLoading || blockedNonIndependent) return;` (add wsLoading/blockedNonIndependent to the dependency array), so no referral RPC runs for hub tutors/managers.

---

