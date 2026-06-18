# oTutorHub — Deep UX / Flow Audit

> Generated 2026-06-18 from a 6-auditor deep-UX workflow (run `w8ysemw83`). Covers every role's flow for dead-ends, friction, shortest-path gaps, emphasis hierarchy, intuitiveness, and good→great delight opportunities.

**Totals: 79 findings — 23 HIGH · 41 MED · 15 DELIGHT**

---

## Remediation tracker (4 packages)

The owner approved building **all four** packages. Status updated as work lands.

### Package 1 — Real flow bugs (correctness / dead-ends)
- [x] SubscriptionPage `iosApp` crash → `nativeApp` (HIGH-6) — _commit fd0ed23_
- [x] Manager dashboard FAB mis-wire: Add-student / Create-lesson / payment now route to the canonical Schedule / People / Finances surfaces; independent-tutor payment de-randomised (HIGH-1, HIGH-2, HIGH-7)
- [x] OnboardingFlowB step-0 writes/reads `tutor_details.user_id` (was non-existent `tutor_id`); `as any` dropped so the type checker guards it (HIGH-14)
- [x] OnboardingContent banner: Continue now routes to `/onboarding` (the good FlowB); dead `OnboardingDialog` wiring removed from AppSidebar (HIGH-16)
- [x] Chats manager zero-state: added «Створити чат» CTA in the empty state; removed dead `PageFAB` import (HIGH-18, MED Chats-empty)
- [x] Bonus (HIGH-3): People add-sheet role is now a primary segmented toggle; FAB is role-contextual («Додати репетитора/учня/менеджера») and deep-linkable via `?add=tutor|student`

### Package 2 — Loud student actions
- [ ] Student «Приєднатися» — labeled, time-aware, never-empty fallback (HIGH-9, HIGH-10)
- [ ] Student homework completion loop + micro-celebration (HIGH-11)

### Package 3 — Hub-tutor + manager accents
- [ ] Hub-tutor dashboard: today's lessons + inline mark-done above payout; promote «Написати менеджеру» (HIGH-12)
- [ ] First-class add-tutor / assign-tutor / set-rate on People (HIGH-3, HIGH-4)

### Package 4 — Delight propagation
- [ ] `useHaptic` across key taps (HIGH-21)
- [ ] Pull-to-refresh visible indicator (HIGH-19)
- [ ] Warm payment-received toast + haptic on FinancesPage (HIGH-20)
- [ ] DayClosedCelebration / first-lesson milestone moments (DELIGHT)
- [ ] Student skeleton loaders

> Remaining MED/DELIGHT items below are catalogued for follow-up; the four packages above target the highest-leverage HIGH findings first.

---

## Auditor summaries & top wins

### Manager

The manager experience is functionally rich but built on a tutor-first chassis, and the seams show. The dashboard is a genuinely good command center — the "Що зробити далі" smart-task list with inline "Виплачено" is the strongest pattern in the app and is the right spine. But the single most-used control, the dashboard "+" FAB, is wired to the INDEPENDENT-TUTOR flows: its "Add student" creates a broken independent record owned by the manager, and its "Create lesson" opens a dialog that is always empty for managers. That one mis-wire poisons the two most frequent manager jobs. Beyond that, the core "add tutor" and "set rate" jobs are buried inside deep card→sheet→dialog drill-downs with no top-level entry, and several manager screens (SubscriptionRequests, AssignTutor) are visibly less polished than the rest of the app. The biggest lever is to make the manager's FAB and empty states route to the RIGHT manager actions, and to surface "add tutor / assign tutor / set rate" as first-class, discoverable actions instead of icon-buttons hidden two taps deep.

**Top wins:**
1. Fix the dashboard FAB for managers: its 'Add student' (QuickAddStudentDialog) writes source:'independent' + tutor_id=manager, and 'Create lesson' (QuickLessonDialog) only loads independent students so it's always empty for a manager. Either give the FAB manager-specific actions (Add person → People sheet, Create lesson → Schedule create dialog, Record payment → wallet) or hide the broken ones. This is a data-corruption-level bug on the #1 manager surface.
1. Make 'Add tutor' and 'Assign tutor + set rate' first-class, discoverable actions. Today add-person role defaults to 'student', assigning a tutor is a 2-tap drill-down (card → sheet → 'Репетитор' button), and setting a rate is hidden behind a pencil icon. Add a role toggle in the People FAB and promote these to labeled buttons.
1. Polish the two manager-only request screens to match the app. SubscriptionRequestsPage still uses a Loader2 spinner (not skeleton), hardcoded Ukrainian strings, and a generic empty state; AssignTutorDialog is a plain centered modal (not the bottom-sheet language) with no margin guidance until both fields are filled. These are the manager's monetization/growth touchpoints and currently feel second-class.

### Independent tutor

Activation is genuinely strong: the gamified OnboardingFlowB (XP, confetti, inline student/lesson creation, cross-step prefill) gets a new tutor to "first lesson scheduled" fast, and the Dashboard's dynamic "next steps" boosters keep momentum. The biggest gap to great is the monetization story: the code has NO hard student-limit paywall (free = unlimited students per useWorkspaceSettings), so the "hit the limit → paywall" moment in the trace simply doesn't exist — value is gated only by feature richness + a trial countdown. That makes the paywall feel like a soft nudge rather than a persuasive moment, and it's undercut by a real crash bug on SubscriptionPage (undefined `iosApp`) that breaks the page for active subscribers, plus a confusing TWO-system payment-recording model (RecordPaymentSheet pair-picker vs WalletDialog per-student) that fragments the single most-repeated task. Fix the crash, unify payment recording, and turn the trial-end into a concrete value-recap moment, and this goes from good to great.

**Top wins:**
1. Fix the SubscriptionPage crash (undefined `iosApp` at line 334) — it throws for any active subscriber with liqpay_recurring_active, breaking the cancel/manage flow on the very page customers pay from.
1. Unify the two payment-recording systems (RecordPaymentSheet's pair-picker vs WalletDialog's per-student 3-tab sheet) into one consistent flow, and make the FAB 'payment' action deterministic instead of branching on whether a lesson exists today.
1. Make the paywall a persuasive value moment, not a soft nudge: since there's no hard student limit, lean the trial-end + ProRulesCard lock into a concrete 'here's what you'd lose' recap (X lessons, Y ₴ tracked, your cancellation rules) tied to a single dominant CTA.

### Hub tutor + Student

The student experience is visually warm and surprisingly motivating where it counts — rewards collection, level/progress bar, achievements with a progress ring, and celebratory toasts are genuinely above-average for this category. But the two CORE jobs of a student — "join the call" and "do homework" — are the weakest, flattest moments in the whole app: joining is a bare unlabeled Zoom icon with no time-gating and a hard dead-end when no link exists, and homework is fully read-only with no completion loop, so the most repeated action a student takes returns zero feedback. The hub tutor screen reads as a clean payout dashboard but buries its #1 job (mark today's lessons done) below the fold and demotes "message the manager" to a quiet gray button, so the two things a hub tutor opens the app to do are the least emphasized. The biggest lever across both roles: make the recurring core actions (join, mark done, do homework) loud, time-aware, and rewarding instead of silent utilities.

**Top wins:**
1. Make the student's core recurring actions loud and rewarding: a labeled, time-aware «Приєднатися» button (with a never-empty fallback when no link exists) and a homework completion loop with a small celebration — these are the two flattest, most-repeated moments and fixing them lifts the whole student experience from functional to motivating.
1. Re-rank the hub-tutor dashboard around the job, not the money: surface today's lessons with inline mark-done at the TOP of the hub block (above the payout card) and promote «Написати менеджеру» out of the quiet bottom outline button, so the two things a hub tutor opens the app to do are the two most emphasized.
1. Personalize and warm the student home: name-based greeting, skeleton loaders instead of bare spinners, and consistently illustrated forward-guiding empty states + a payment copy-to-clipboard with micro-feedback — small polish that closes the perceived-quality gap with the tutor/manager side.

### First-run / onboarding

The first-run is a tale of two qualities. The independent-tutor path is genuinely strong: AuthPage auto-redirects new tutors into OnboardingFlowB, a polished, gamified, one-step-at-a-time flow with inline actions, confetti, XP, and 3 mandatory essentials before bonuses — this is close to great. But it is undermined by a real data bug (step 0 "subject" writes to a non-existent tutor_details.tutor_id column, so the very first step silently fails to persist and never auto-completes), and by a second, completely different onboarding implementation (OnboardingContent, reached from the dashboard banner) that is currently broken — no step is marked required, so it renders an empty mandatory section and jumps straight to a collapsed "optional" accordion. The student path is the weakest: a self-signup student finishes a quiz that promises "find a tutor," then lands on a dashboard whose empty state cheerfully says "a lesson is coming soon!" with NO way to actually request a tutor — a textbook dead-end with a false promise. Hub tutors and managers get no first-run guidance at all. The single biggest lever: make the student's first-value path (request/get a tutor) as obvious and guided as the tutor's, and fix the two onboarding breakages so the tutor flow actually delivers what it shows.

**Top wins:**
1. Fix the OnboardingFlowB step-0 subject bug: it writes/reads tutor_details on a non-existent `tutor_id` column (should be `user_id`). The first onboarding step silently fails to save and never auto-completes — make the very first action actually work.
1. Give the self-signup student a real path to first value: add a prominent 'Find a tutor' CTA (FindTutorDialog) to the student dashboard empty state, and have the onboarding quiz actually create a tutor request so the 'we'll match you in 24h' promise is true. Today they hit a cheerful dead-end with no next action.
1. Repair OnboardingContent (the dashboard-banner 'Continue' flow): no step has required:true, so the mandatory section is empty and it opens straight into a collapsed optional accordion. Either mark the 3 essentials required or route the banner to OnboardingFlowB so there is one coherent onboarding.

### Navigation / IA

Navigation is mostly coherent for tutor/manager on desktop (one role-scoped sidebar, a consistent PageFAB on most pages), but it fractures in three places that a first-time user will feel: (1) the student experience runs on TWO different chrome systems — StudentLayout for dashboard/payments/homework and AppLayout for /chats and /schedule — with different headers (the notification bell appears only on /chats, nowhere else for students), so the app visibly "changes shape" mid-flow. (2) FAB discipline is inconsistent: Dashboard uses a bespoke expandable AddFab (square 58px, bottom 88), every other page uses the round 52px PageFAB (bottom 78), and Chats has NO FAB at all despite importing it — its only create affordance is an inline pill that disappears in the zero-chats empty state, producing a hard dead-end for a manager with no chats. (3) Information architecture buries revenue- and retention-critical surfaces (Achievements, Availability, Subscription, Referrals) two levels deep under Profile → More, while a computed subscription-requests badge is wired up but never rendered. The single biggest lever: unify the FAB into one component/shape/position, give every empty state a forward action (especially Chats and the student dashboard), and promote the buried high-value destinations out of the Profile junk-drawer.

**Top wins:**
1. Fix the Chats dead-end: a manager with zero chats currently sees an empty state with NO create button (the 'new chat' pill lives only in the threads>0 branch). Add a primary CTA into the empty state and either render PageFAB (currently a dead import) or move new-chat to it, so there is always one obvious way to start a conversation.
1. Unify FAB discipline into a single component: replace the bespoke AddFab/PageFAB/QuickActionsFab divergence with one FAB shape, size, and bottom offset across ALL pages so the primary action is in the same place with the same affordance everywhere; remove the dead PageFAB + QuickActionsFab imports from DashboardPage.
1. Collapse the student's dual-chrome (StudentLayout vs AppLayout) so /chats and /schedule don't swap the header/bell/nav system; at minimum give every student screen the same header treatment (consistent presence-or-absence of the notification bell) so the app stops changing shape between tabs.

### Feel / delight

The foundation here is genuinely good, not just functional: skeletons (not spinners) are wired into all 7 main pages, the empty-state microcopy is warm and human (uk.ts is full of "☀️ Вільний час", "🎉 Чисто! Всі оплатили"), and the Dashboard "complete a lesson" beat is a model of great feel — optimistic UI + confetti + a warm toast that offers "Оплачено ✓" inline + streak nudge + a day-closed celebration overlay. The gap to GREAT is concentrated in three places: (1) several delight mechanics are built but only half-connected — usePullToRefresh fires but renders NO visual indicator, and useHaptic is imported in exactly one of dozens of key-tap surfaces; (2) the manager's single most emotional money moment (marking a payment received on FinancesPage) is flat — no haptic, no confetti, cold "Збережено"/"✓ Позначено" copy — while the identical action on the Dashboard sparkles; (3) the celebration/closing flows leak hardcoded Ukrainian strings ("Учень оплатив?", "Закрити день", "Надіслати запит"), which both breaks i18n and reads less polished than the i18n copy around them. The biggest single lever: make haptics + a payment-received micro-celebration universal across every "money in" / "task done" tap, and finish the two half-wired mechanics (pull indicator, day-closed haptic).

**Top wins:**
1. Finish the two half-wired mechanics: render a real pull-to-refresh indicator (pullProgress is computed but never shown), and fire confetti + haptic + the DayClosedCelebration overlay from the CloseDayDialog batch-close path — right now the better one-tap close flow is the LESS rewarding one.
1. Make haptics + the warm '💰 +{amount} від {name}!' payment celebration universal: add haptic.success/tap/error across all key taps (currently in just 1 component) and bring the Dashboard's delightful payment-received moment to FinancesPage, where managers actually live and where it's currently a cold '✓ Позначено'.
1. Close the microcopy/i18n gaps in the FEEL surfaces: move the hardcoded Ukrainian celebration strings ('Учень оплатив?', 'Закрити день', 'Надіслати запит') into i18n, swap the cold 'Збережено' on payment save for a warm money-in confirmation, and give the genuine first-lesson and badge-unlock milestones their own escalated moment instead of the generic toast.

---

## HIGH (23)

### HIGH-1 · dead-end · Manager

**Flow:** Dashboard → FAB → 'Учня' (Add student)

**Issue:** The manager dashboard FAB (AddFab) wires onStudent to setAddStudentOpen, which opens QuickAddStudentDialog. That dialog UNCONDITIONALLY inserts student_rates with source:'independent' and tutor_id:user.id (the manager). For a manager this creates a malformed student: an 'independent' student owned by the manager-as-tutor, which then won't appear correctly in hub flows, AssignTutor, or Finances. The manager's real add-student path is the People page FAB.

**File:** `src/pages/DashboardPage.tsx:2304 (onStudent) + src/components/QuickAddStudentDialog.tsx:107-114 (source:'independent', tutor_id:user.id)`

**Fix:** For isManager, the FAB's 'Add student' must open the People-style add-person flow (ghost profile + role=student, no independent rate) or navigate to /people with the add sheet open. Do not reuse QuickAddStudentDialog for managers. Simplest: gate AddFab actions by role and for managers route student/lesson to the canonical People/Schedule dialogs.

### HIGH-2 · dead-end · Manager

**Flow:** Dashboard → FAB → 'Урок' (Create lesson)

**Issue:** For managers, the FAB onLesson opens QuickLessonDialog, which loads students with .eq('tutor_id', user.id).eq('source','independent'). A manager has no such rows, so the student list is always empty and no lesson can be created — a silent dead-end on the most common 'schedule a lesson' job. The working manager path is SchedulePage's create dialog (loads all tutors + students, source 'hub').

**File:** `src/components/QuickLessonDialog.tsx:104-115 (independent-only query); opened from src/pages/DashboardPage.tsx:2303`

**Fix:** For managers, route the FAB 'Create lesson' to the SchedulePage create dialog (navigate('/schedule') and trigger create, or lift that dialog) rather than QuickLessonDialog. Never show a creation dialog that can't be completed for the active role.

### HIGH-3 · intuitiveness · Manager

**Flow:** Add a tutor (People)

**Issue:** There is no obvious 'Add tutor' entry. The People FAB opens an add-person sheet whose role Select defaults to 'student' (addForm.role:'student'). A first-time manager onboarding their school must know to open the sheet, change the role dropdown to 'Репетитор', then reveal subjects. The single most important onboarding job (populate the hub with tutors) is undifferentiated from adding a student.

**File:** `src/pages/PeoplePage.tsx:171-178 (role default 'student'), 1662-1687 (role select + conditional subjects)`

**Fix:** Make role primary: in the add sheet, lead with a segmented Tutor/Student toggle at the top (not a buried Select), and consider a dedicated FAB action or default the role based on the active People tab (activeRoleTab tutors → preselect tutor). Label the FAB contextually ('Додати репетитора' on the Tutors tab).

### HIGH-4 · extra-steps · Manager

**Flow:** Assign tutor + set rate to a student (People)

**Issue:** Assigning a tutor to a student is a 3-level drill-down: tap student card → bottom sheet opens → tap the small 'Репетитор' tile → a DIFFERENT dialog (addTutorToStudent) opens. Setting/editing the rate is hidden behind a pencil icon next to a rate row. For the manager's core 'wire up a student' job, the primary action is neither visually dominant nor reachable in one obvious step.

**File:** `src/pages/PeoplePage.tsx:1958-2004 (3-col grid Репетитор/Гаманець/Ставка inside the sheet), 1881-1900 (pencil to edit tutor rate)`

**Fix:** When a student has no tutor yet, the bottom sheet's primary CTA should be a single full-width 'Призначити репетитора' button (teal, dominant) instead of an equal-weight 3-tile grid where the key action looks identical to Wallet/Rate. Auto-open that flow for tutor-less students.

### HIGH-5 · emphasis · Manager

**Flow:** Subscription requests (manager inbox)

**Issue:** This monetization-critical screen is visibly downlevel vs the rest of the app: full-page Loader2 spinner instead of a skeleton, hardcoded Ukrainian strings ('Запити на підписку', 'Поки що немає жодного запиту…', 'Взяти в роботу', 'Завершити', 'Відхилити') breaking i18n, and three equally-weighted action buttons so the primary ('Завершити') doesn't clearly dominate. There's also a redundant control pair: a status Select AND three status buttons that do the same transitions.

**File:** `src/pages/SubscriptionRequestsPage.tsx:135-141 (hardcoded title), 146-153 (spinner + bare empty state), 240-288 (Select + 3 buttons redundancy)`

**Fix:** Replace spinner with a list skeleton; route all strings through i18n; pick ONE control model (keep the 3 action buttons, drop the duplicate Select, or vice-versa) and make 'Завершити' the single dominant teal CTA; warm up the empty state ('Поки тихо — нових запитів немає ✨').

### HIGH-6 · dead-end · Independent tutor

**Flow:** Subscribe / manage subscription (SubscriptionPage)

**Issue:** `iosApp` is referenced at the trial-hero active state but is never defined — only `nativeApp` exists (defined line 82). For an ACTIVE subscriber whose `settings.liqpay_recurring_active` is true, this line evaluates `iosApp` → ReferenceError → the whole SubscriptionPage white-screens. This is the exact screen a paying customer returns to in order to cancel/manage, so they hit a dead-end with no recovery.

**File:** `src/pages/SubscriptionPage.tsx:334`

**Fix:** Replace `!iosApp` with `!nativeApp`. Add a render test/ErrorBoundary fallback for this page so a single undefined var can never blank the billing screen.

### HIGH-7 · friction · Independent tutor

**Flow:** Record payment (FAB → payment, FinancesPage, WalletDialog vs RecordPaymentSheet)

**Issue:** There are two different, visually distinct payment-recording UIs for the same job. RecordPaymentSheet (FinancesPage FAB) opens a pair-PICKER then lesson/prepay tabs; WalletDialog (Dashboard FAB, People, MyStudents) is a per-student sheet with mark/topup/history tabs and different segmented controls and copy. A first-time tutor recording their first cash payment sees a different layout depending on where they tapped, doubling the learning cost for the most-repeated task.

**File:** `src/components/RecordPaymentSheet.tsx:183 / src/components/WalletDialog.tsx:226`

**Fix:** Pick WalletDialog (richer: mark+topup+history, bulk-check, balances) as the single payment surface. Have FinancesPage/RecordPaymentSheet route into the same WalletDialog after pair selection, or fold the pair-picker into WalletDialog as a pre-step. Retire the divergent segmented-control styling.

### HIGH-8 · friction · Independent tutor

**Flow:** Dashboard FAB → 'Оплату' (payment quick action)

**Issue:** The FAB payment action is non-deterministic: `onPayment` does `const first = todayLessons[0]; if (first) setWalletPair(...) else openPaymentSheet()`. So the same button opens a per-student prepay WalletDialog for today's first (possibly unrelated) student when a lesson exists, but a pair-picker sheet otherwise. The user can't predict what 'record payment' will do, and it silently picks an arbitrary student.

**File:** `src/pages/DashboardPage.tsx:2305`

**Fix:** Always open the unified payment sheet starting at the pair/student picker. Don't auto-target todayLessons[0] — that guesses the wrong student. If you want a shortcut, surface 'record payment' inline on each lesson card instead of guessing in the FAB.

### HIGH-9 · emphasis · Independent tutor

**Flow:** Trial-end / paywall moment (Dashboard trial banner + SubscriptionPage)

**Issue:** The monetization story is weak at the decision moment. useWorkspaceSettings explicitly gives free users UNLIMITED students (lines 20-24), so the trace's 'hit the free-plan limit → paywall' never fires — there's no scarcity moment. The persuasion instead rests on a trial countdown + a generic 10-card benefits list on SubscriptionPage. The SubscriptionPage hero leads with a 40px day-count number, but the actual 'why pay' (the tutor's own data: lessons run, ₴ tracked, rules configured) only appears in a small dismissible Dashboard banner, not on the paywall itself.

**File:** `src/pages/SubscriptionPage.tsx:345 (trial hero) / src/pages/DashboardPage.tsx:1387 (recap banner)`

**Fix:** Move the concrete personal recap (X lessons, Y ₴ tracked this month, your cancellation policy) INTO the SubscriptionPage hero as the dominant element above the price card, and reduce the 10 benefit cards to the top 3. Frame Pro as 'keep what you've built' rather than a feature list.

### HIGH-10 · dead-end · Hub tutor + Student

**Flow:** Student → join the call (dashboard + schedule)

**Issue:** The primary student job — joining a lesson — is a bare 44px Zoom video icon with aria-label "Zoom" and NO visible text label. A first-time student has no idea this teal square is how they enter the call. Worse: when a lesson has no meeting_url, NOTHING renders (StudentDashboardPage L209 `{l.meeting_url && (...)}`, StudentSchedulePage L109), so a student who sees "Сьогодні 15:00" but whose tutor hasn't pasted a link is fully stuck with no guidance, no "link coming", and no way to ask — a textbook тупик at the most important moment.

**File:** `src/pages/student/StudentDashboardPage.tsx:209`

**Fix:** Replace the icon-only link with a labeled primary button reading «Приєднатися» / «Join» when meeting_url exists. When it's missing, render a quiet but explicit placeholder («Посилання зʼявиться перед уроком» + a chat-tutor shortcut) instead of empty space, so the student always has a next action.

### HIGH-11 · intuitiveness · Hub tutor + Student

**Flow:** Student → join the call (timing)

**Issue:** The join button is shown identically whether the lesson is in 3 days or in 2 minutes — there is no "starts in 10 min", no live/now state, no countdown. The single most magical moment (it's time, tap to enter) is indistinguishable from a far-future lesson. A first-time student doesn't know if tapping now is even valid.

**File:** `src/pages/student/StudentDashboardPage.tsx:181`

**Fix:** Add a time-aware state to the next lesson: within ~15 min of start, pin it to the top, switch the button to a glowing «Приєднатися зараз» with a soft pulse + a «через X хв» / «йде зараз» label. Outside the window keep it calm. This turns a static list into a live "now" cue.

### HIGH-12 · dead-end · Hub tutor + Student

**Flow:** Student → do homework

**Issue:** StudentHomeworkPage is 100% read-only: the student can read the task, open an AI summary, and download a file, but there is NO «Готово»/mark-done, no checkbox, no submit, no note back to the tutor. The job "do homework" has no completion loop — homework never moves out of Active, the dashboard homeworkCount never drops by student action, and the student gets zero acknowledgement for finishing. This is the flattest core flow in the app.

**File:** `src/pages/student/StudentHomeworkPage.tsx:160`

**Fix:** Add a lightweight «Позначити виконаним» toggle per card (optimistic, persists a student_homework_done flag), move done items to a «Виконано» state with a small celebration (✓ + streak/reward nudge), and reflect the count drop on the dashboard. Even without tutor-facing submission this closes the loop and makes effort feel seen.

### HIGH-13 · emphasis · Hub tutor + Student

**Flow:** Hub tutor → mark today's lessons done

**Issue:** The #1 hub-tutor job (mark lessons done) is NOT in the hub block at all. The hub section (DashboardPage 1698–1838) shows payout, two stat tiles, a Pro chip, pending payments, and a quiet manager button — but "уроки сьогодні" is just a number (L1796), not actionable. The actual marking UI (NeedsMarkingCard / needsMarkLessons LessonCards) lives BELOW this block at L1848+, so the primary recurring action is below the fold and visually subordinate to a payout figure the tutor only checks occasionally.

**File:** `src/pages/DashboardPage.tsx:1782`

**Fix:** Make today's lessons the emphasized top element of the hub block: render today's LessonCards with the status control inline right under the hub chip, before the payout card, with a clear «Відмітити проведені» framing. The payout card can move to second position — money owed is reassuring but secondary to the daily task.

### HIGH-14 · dead-end · First-run / onboarding

**Flow:** Independent tutor onboarding — Step 0 (pick subject), OnboardingFlowB

**Issue:** The very first onboarding step writes the subject to tutor_details with a `tutor_id` key (`upsert({ tutor_id: user.id, subjects }, { onConflict: 'tutor_id' })`) but the table is keyed on `user_id` and has no `tutor_id` column. The `(as any)` cast hides the type error. The auto-detect reader on line 1037 also queries `.eq('tutor_id', user.id)`. Result: the subject never persists, hasSubject never auto-completes, and the polished flow's flagship first action silently no-ops. OnboardingContent does this correctly with user_id, proving the right column.

**File:** `src/components/OnboardingFlowB.tsx:178 (write) and :1037 (read)`

**Fix:** Change both to `user_id`: write `upsert({ user_id: user.id, subjects: sel }, { onConflict: 'user_id' })` and read `.eq('user_id', user.id)`. Remove the `as any` so the type checker guards this. Verify the StepVictoryOverlay then fires for step 0.

### HIGH-15 · dead-end · First-run / onboarding

**Flow:** Self-signup student — first dashboard after onboarding quiz

**Issue:** A student who self-registers completes the StudentOnboarding quiz (whose header literally says 'find tutor' and whose done-screen says 'the manager already got your request, we'll match you within 24h'), then lands on /student-dashboard. With no tutor assigned, the upcoming-lessons block shows studentPages.noLessons = '☀️ Поки вільно — незабаром буде урок!' ('Free for now — a lesson is coming soon!'). There is NO Find-a-tutor / Request-tutor CTA anywhere on the student dashboard (grep confirms FindTutorDialog is absent). The promised request is never actually created by the quiz. The student is stuck staring at a false 'lesson coming soon' with no action.

**File:** `src/pages/student/StudentDashboardPage.tsx:178 and src/components/student/StudentOnboarding.tsx:139-149`

**Fix:** When a student has zero tutors, replace the flat noLessons text with an EmptyState that includes a primary FindTutorDialog CTA (the same one SchedulePage uses at line 1601). Better: have the onboarding quiz submit actually create the tutor request so the 'we'll match you' copy is true, then show a 'Request sent — we're matching you' state with a secondary 'edit preferences' link.

### HIGH-16 · dead-end · First-run / onboarding

**Flow:** Independent tutor — 'Continue setup' from TutorWelcomeBanner / OnboardingDialog

**Issue:** TutorWelcomeBanner's 'Continue' opens OnboardingDialog → OnboardingContent. But NO step in OnboardingContent sets required:true, so requiredSteps is [] → the mandatory steps map renders nothing, and requiredDone is vacuously true → the component jumps straight to the collapsed 'Налаштуй більше ✨ / optional' accordion. A tutor who clicks the prominent gamified banner CTA sees an almost-empty modal with a collapsed accordion and no obvious primary action. This is a different, half-broken onboarding implementation living alongside the good OnboardingFlowB.

**File:** `src/components/OnboardingContent.tsx:513-518, 731, 910 (step defs lines 69-218 have no `required`)`

**Fix:** Pick ONE onboarding. Simplest: make the banner's Continue route to /onboarding (OnboardingFlowB) instead of opening OnboardingDialog, and retire OnboardingContent. If keeping it, mark steps 0/1/2 (subject/student/lesson) `required:true` so the mandatory section renders and the modal has a clear first action.

### HIGH-17 · dead-end · Navigation / IA

**Flow:** Chats (manager) — zero chats state

**Issue:** When threads.length === 0, ChatsPage renders ONLY a passive empty-state card (icon + noChatsManager text) with no action. The only 'new chat' affordance is an inline pill rendered inside the `threads>0` list-header branch (line ~836-845), so a manager who has never started a chat literally cannot start one from this screen. PageFAB is imported (line 4) but never rendered anywhere in the file.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/pages/ChatsPage.tsx:797`

**Fix:** Add a primary 'Start a chat' button to the empty-state block (calls openNewChatDialog) for managers, AND render <PageFAB onClick={openNewChatDialog}> for managers so the create action is always reachable (matching SchedulePage/PeoplePage which gate the FAB and also give the empty state a CTA).

### HIGH-18 · intuitiveness · Navigation / IA

**Flow:** Student — global chrome (all student pages)

**Issue:** Pure-student pages split across two layout systems: StudentDashboard/Payments/Homework use StudentLayout (mobile header = title only, NO bell, NO burger), while /schedule and /chats use AppLayout (mobile header = title + golden NotificationBell + teal burger). MobileBottomNav even has a dedicated 'mirror' branch (lines 24-63) to hide the seam. Net effect: a student sees a notification bell ONLY on /chats and a menu burger only on AppLayout pages — the app visibly changes shape between tabs, and notifications are effectively undiscoverable for students.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/student/StudentLayout.tsx:85`

**Fix:** Add the NotificationBell to StudentLayout's mobile header (and a consistent overflow/menu affordance) so the header is identical across all student screens, or route student /chats and /schedule through StudentLayout. The bottom-nav mirror hack is a symptom — the real fix is one chrome for the student role.

### HIGH-19 · emphasis · Navigation / IA

**Flow:** All pages — FAB / primary action

**Issue:** Three competing FAB implementations with different shape, size, and position: Dashboard uses AddFab (square rounded-[18px], 58px, bottom:88, expandable with 3 actions), every other page uses PageFAB (round, 52px, bottom-[78px], single action), and QuickActionsFab is a third sheet-based variant. The primary action is therefore in a slightly different place and a different shape depending on the page, which undermines the 'one obvious primary action, same spot every time' principle. Dashboard also carries dead imports of both PageFAB and QuickActionsFab (lines 40, 44) that it never uses.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/PageFAB.tsx:24`

**Fix:** Standardize on ONE FAB: pick the shape/size/offset (recommend the round PageFAB geometry) and let it optionally expand into AddFab's 3-action menu. Make Dashboard use the unified component; delete the unused PageFAB and QuickActionsFab imports from DashboardPage. Align bottom offsets (78 vs 88) to a single token so the FAB doesn't visibly jump position between Dashboard and other tabs.

### HIGH-20 · intuitiveness · Navigation / IA

**Flow:** Mobile burger — menu vs profile (whole app)

**Issue:** There are two contradictory 'burger' behaviors. AppLayout's mobile header burger dispatches `toggleSidebar` (opens the nav drawer) — correct. But the standalone PageHeader component's burger is a <Link to="/profile"> (line 25-32). Both render an identical teal square with a Menu icon, so the same glyph means 'open navigation' in one place and 'go to profile' in another. (PageHeader is currently unused by any page, but it's the shared header primitive and will mislead whoever adopts it.)

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/PageHeader.tsx:25`

**Fix:** Make the Menu glyph mean exactly one thing app-wide: open the nav drawer (dispatch toggleSidebar), matching AppLayout. If 'go to profile' is wanted, use the user avatar, not a hamburger. Then actually adopt PageHeader across pages so headers stop being re-implemented per page (Schedule, Finances, People, Groups each hand-roll their own header).

### HIGH-21 · delight · Feel / delight

**Flow:** Dashboard — pull-to-refresh

**Issue:** usePullToRefresh is consumed in DashboardPage (line 333: `const { isPulling, pullProgress } = usePullToRefresh(...)`) but isPulling and pullProgress are NEVER rendered anywhere — grep finds zero JSX references. The user pulls down and sees absolutely nothing: no '↓ Потягни / ↻ Відпусти' affordance, no spinner, no rubber-band. The mechanic silently reloads data with no feedback, so it reads as 'broken' rather than 'refreshing'. CLAUDE.md even documents the indicator copy as if it exists, but it doesn't.

**File:** `src/pages/DashboardPage.tsx:333`

**Fix:** Render a pull indicator driven by pullProgress: a fixed top strip that translates/opacity-scales with pullProgress (0→1), showing a chevron + 'Потягни щоб оновити' that flips to a spinning ↻ + 'Відпусти' at pullProgress >= 1, then a brief 'Оновлено ✨' on completion. Even a 20-line absolutely-positioned element closes the loop. Add the i18n keys pullToRefresh.pull / .release / .done.

### HIGH-22 · delight · Feel / delight

**Flow:** Manager Finances — marking a payment received

**Issue:** The manager's most emotionally rewarding action — money landing — is flat on FinancesPage. updatePayment-equivalent there (line 685) fires only a cold toast.success('✓ Позначено як оплачено') with an Undo. No haptic, no confetti, no celebratory '+amount from {name}' framing. Meanwhile the IDENTICAL action on the Dashboard (DashboardPage.tsx:773) shows the delightful '💰 +{amount} від {name}!' toast. So the same beat feels magical on one screen and bureaucratic on the screen literally named 'Finances' where managers spend the most time.

**File:** `src/pages/FinancesPage.tsx:685`

**Fix:** Reuse the Dashboard pattern on Finances: on student_payment_status→paid, fire haptic.success() + the warm 'finances.received'/paymentReceivedToast '💰 +{amount} від {name}!' toast (keep the Undo action). For bulk 'allMarkedPaid', add a small confetti burst (reuse burstConfetti) and haptic.success — closing a whole debt list is a real win worth celebrating.

### HIGH-23 · delight · Feel / delight

**Flow:** Global — haptics on key taps

**Issue:** useHaptic exists with well-tuned tap/success/error patterns but is imported in exactly ONE component (NeedsMarkingCard.tsx). Every other high-intent tap — completing a lesson on Dashboard, marking paid on Finances, submitting CloseDayDialog, recording a payment, sending an invite, badge unlock — has zero haptic. On mobile (the primary target per CLAUDE.md), the app feels 'dead' under the thumb everywhere except one card. Haptics are the cheapest single upgrade from good→great on touch.

**File:** `src/hooks/useHaptic.ts:5`

**Fix:** Add haptic.success() to: lesson-complete (DashboardPage.tsx:703, alongside burstConfetti), payment-paid (DashboardPage:769 and FinancesPage:685), CloseDayDialog.apply success (CloseDayDialog.tsx:87), RecordPaymentSheet save (RecordPaymentSheet.tsx:177), and badge unlock (useBadgeUnlockToasts.ts:56). Add haptic.tap() to FAB and primary submit buttons. Add haptic.error() to every toast.error path. This is a ~1-line-per-site change.

---

## MED (41)

### MED-1 · friction · Manager

**Flow:** Assign tutor dialog (from tutor-referral requests)

**Issue:** AssignTutorDialog is a plain centered max-w-md modal — it breaks the app's bottom-sheet language used by every other manager dialog (People rate dialogs, Wallet, ContactEdit, RatePropagation all use rounded-t-[20px] sheets). It also shows the school margin only AFTER both price fields are typed, and the student price field has no prefill/hint, so the manager is guessing pricing with no anchor. Footer buttons 'Скасувати'/'Призначити' are hardcoded strings.

**File:** `src/components/AssignTutorDialog.tsx:223-224 (centered modal, not sheet), 217-292 (margin appears only when both filled), 296-305 (hardcoded button labels)`

**Fix:** Convert to the bottom-sheet pattern for consistency; prefill student price from the tutor's existing rate for that student/subject if any, or show a suggested margin range; always render the margin row (even as a placeholder) so the manager sees the economics while typing; i18n the buttons.

### MED-2 · intuitiveness · Manager

**Flow:** Rate propagation (after editing a student price)

**Issue:** After saving a changed student price, RatePropagationDialog interrupts with a 4-option radio (future unpaid / all unpaid / all / skip) using terse labels. The success toast ('Ціна збережена') fires BEFORE this dialog, so the manager thinks they're done, then a second modal appears asking a non-obvious billing question with no preview of how many lessons each option affects. First-timers won't understand 'all' silently rewrites already-paid lessons.

**File:** `src/pages/PeoplePage.tsx:539-552 (success toast then propagate), src/components/RatePropagationDialog.tsx:104-133 (4 radios, no affected-count)`

**Fix:** Show the count of lessons each scope would touch inline (e.g. 'майбутні неоплачені — 3 уроки'), default to future_unpaid (already does), and visually flag the 'all' option as caution. Suppress the premature 'saved' toast until the propagation choice is resolved, or merge into one confirmation step.

### MED-3 · friction · Manager

**Flow:** Mark student paid / Wallet (dashboard + People)

**Issue:** There are at least three different 'mark paid' surfaces with inconsistent models: LessonCard inline pay toggle, the WalletDialog 'Відмітити' tab (multi-select checklist), and the post-completion toast action 'Оплачено ✓'. From the People student sheet, tapping 'Гаманець' or 'Ставка' when the student has no tutor silently redirects into the assign-tutor flow via a toast.info — surprising behavior that hijacks the tap the manager intended.

**File:** `src/pages/PeoplePage.tsx:1973-1983 & 1992-1999 (Wallet/Rate tiles reroute to openAssignTutor), src/components/WalletDialog.tsx:286-343 (mark tab)`

**Fix:** Disable (grey out) the Wallet/Ставка tiles when no tutor is assigned and show an inline hint 'Спершу призначте репетитора' rather than rerouting on tap — a disabled affordance is more honest than a tap that does something different than its label.

### MED-4 · empty-state · Manager

**Flow:** Chats (manager, empty)

**Issue:** The manager's all-chats empty state (threads.length===0) is the generic dashed-border card with text only — no action button to start a chat, even though the manager-only 'Нова' button exists in the populated list header. A first-time manager landing on an empty Chats screen has no forward path from the empty state itself.

**File:** `src/pages/ChatsPage.tsx:797-806 (empty state, no CTA) vs 836-845 (new-chat button only in list header)`

**Fix:** Add a primary 'Почати чат' button inside the empty-state card (managers), reusing openNewChatDialog, so the empty state guides forward instead of dead-ending.

### MED-5 · extra-steps · Manager

**Flow:** Delete a person (People)

**Issue:** Purging a person requires window.confirm THEN a window.prompt to type 'DELETE' — two native browser dialogs that clash with the app's polished sheet aesthetic and feel jarring/unsafe-looking. Archive uses a single confirm. The double-native-prompt is heavy friction for what is occasionally a routine cleanup.

**File:** `src/pages/PeoplePage.tsx:743-777 (confirm + prompt 'DELETE')`

**Fix:** Replace the native confirm/prompt chain with a single styled AlertDialog containing a type-to-confirm input, matching the app's dialog system. Keep the typed-confirmation safety, lose the OS popups.

### MED-6 · friction · Manager

**Flow:** Onboarding / first-run (manager)

**Issue:** A brand-new manager with no tutors/students/lessons sees a dashboard whose smart-task list is empty ('Все під контролє' all-clear state) — which reads as 'nothing to do' when in fact they have everything to do (set up the school). There's no manager-specific 'getting started' sequence (independent tutors get TUTOR_BONUS_TASKS and an /onboarding redirect; managers get neither).

**File:** `src/pages/DashboardPage.tsx:2093-2104 (manager all-clear empty state), 1140-1300 (smartTasks only produces items when data already exists)`

**Fix:** For managers with zero tutors/students, replace the 'all clear' state with a first-run checklist: '1. Додайте репетитора → 2. Додайте учня → 3. Призначте репетитора → 4. Заплануйте урок', each linking to the right flow. Mirror the tutor onboarding pattern for the manager role.

### MED-7 · intuitiveness · Manager

**Flow:** Hidden primary action — student price/rate dialog reachability

**Issue:** The student price dialog and add-tutor-to-student dialog can only be opened from inside the person bottom sheet (openRateFor/openAssignTutor set selectedPerson=null first). There is no way to reach 'set this student's rate' from the dashboard 'students without tutor' smart task except navigating to /people and re-finding the student. The smart task 'N учнів без репетитора' deep-links to /people but not to the specific student or the assign flow.

**File:** `src/pages/DashboardPage.tsx:1223-1234 (students-no-tutor task → /people), src/pages/PeoplePage.tsx:1727-1752 (open flows only from sheet)`

**Fix:** Deep-link the 'students without tutor' task to /people?filter=needs-tutor (a filter that doesn't yet exist) or open the first such student's assign sheet directly. Reduce the path from task→list→search→card→sheet→button to task→assign.

### MED-8 · extra-steps · Independent tutor

**Flow:** Onboarding — essential steps (subject / student / lesson)

**Issue:** The three 'essential' onboarding steps cannot be skipped (Skip ghost button only renders for non-essential steps: `!isEssential && !alreadyDone`). A tutor who signed up just to look around, or who wants to add a real student later, is forced to create a (fake) student and a lesson before reaching the dashboard. There's no 'I'll do this later' escape on the highest-friction steps.

**File:** `src/components/OnboardingFlowB.tsx:1267`

**Fix:** Allow a low-emphasis 'Зроблю пізніше' on essential steps too (still default to encouraging completion). The bonus-task system on the Dashboard already re-surfaces incomplete steps, so skipping is safe and reduces forced fake-data entry.

### MED-9 · friction · Independent tutor

**Flow:** Schedule → full create-lesson form with no students

**Issue:** In the SchedulePage full create dialog, when an independent tutor has no students the student select shows a dashed hint whose only action is a Link to /my-students that CLOSES the create dialog (`onClick={() => setCreateOpen(false)}`). The user loses the half-filled lesson form and must navigate away, add a student, then come back and start over. The QuickLessonDialog handles this far better with an inline '+ add student' that reloads in place.

**File:** `src/pages/SchedulePage.tsx:1093`

**Fix:** Replace the navigate-away Link with the same inline QuickAddStudentDialog used in QuickLessonDialog (line 588-592), reloading the student list on creation so the lesson form stays intact.

### MED-10 · empty-state · Independent tutor

**Flow:** My Students — empty active list

**Issue:** The empty-state title is 'У вас поки немає власних учнів' (line 1181) — a literal 'Немає X' negative pattern that the project's own CLAUDE.md flags as MANDATORY to avoid ('ZERO Немає X patterns. Always warm and positive'). It's the first thing a brand-new tutor sees on this page, so it sets a flat, administrative tone at the activation moment instead of an inviting one.

**File:** `src/i18n/locales/uk.ts:1181 (myStudents.emptyActiveTitle)`

**Fix:** Rewrite to the positive framing already used elsewhere, e.g. 'Час познайомитись з першим учнем! 🚀' (matches the noStudents key in CLAUDE.md). Keep the existing teal 'Додати учня' CTA as the single dominant action.

### MED-11 · intuitiveness · Independent tutor

**Flow:** Dashboard (independent) — hardcoded strings & fragile pluralization

**Issue:** The independent Dashboard branch has many hardcoded Ukrainian strings instead of i18n keys (violates the project i18n rule), and one fragile manual pluralization hack: the 'Сьогодні · N урок' label uses `'урок'.slice(0, todayLessons.length === 1 ? 5 : ...)` to fake plural endings — it produces wrong/garbled forms and won't translate. Examples also at the trial chip (1346-1348), recap banner (1394-1397), card labels (1439/1471/1483/1507/1522/1541), invite-reminder card (1671-1673), '100% налаштовано' (2209-2210), skip tooltips (2238-2239), 'Завжди можна підключити у Профілі' (2249).

**File:** `src/pages/DashboardPage.tsx:1968`

**Fix:** Replace the slice() pluralization with an i18n key using count plural rules (e.g. t('dashboard.lessonsTodayCount', {count})), and move the listed hardcoded strings into uk/en/sv. This also unblocks the en/sv locales where these currently render Ukrainian.

### MED-12 · friction · Independent tutor

**Flow:** Quick-add student — required price gate

**Issue:** QuickAddStudentDialog marks price as required (`*`, validated `isNaN(price) || price < 0` blocks submit). A tutor adding a student before they've agreed on a rate (common for a trial/first lesson) is hard-blocked. OnboardingFlowB's student step also requires price. This adds friction to the single most important activation action (add first student).

**File:** `src/components/QuickAddStudentDialog.tsx:87`

**Fix:** Make price optional (default 0 / 'set later'), or accept empty and store null. Keep the cream price card prominent but not blocking, so adding a student never stalls on a number the tutor doesn't have yet.

### MED-13 · dead-end · Independent tutor

**Flow:** Quick-add student success → InviteLinkDialog

**Issue:** After adding a student, success closes the add sheet and opens InviteLinkDialog. But the student was created with no email/phone unless the tutor expanded 'add contacts' (collapsed by default, only required if neither name+contact… actually contact is required). For a student added with only phone, the invite step may have nothing actionable, and there's no clear 'what now' bridge back to the obvious next step (schedule their first lesson). The toast fires but the flow doesn't hand the user forward to lesson creation.

**File:** `src/components/QuickAddStudentDialog.tsx:159`

**Fix:** In InviteLinkDialog success state for an independent tutor, add a primary 'Запланувати перший урок' button that opens QuickLessonDialog pre-filled with the new studentId (QuickLessonDialog already accepts initialStudentId).

### MED-14 · intuitiveness · Independent tutor

**Flow:** Availability (AvailabilityPage / Schedule link)

**Issue:** Availability is a confusing split: AvailabilityPage.tsx is explicitly a legacy compatibility shell ('Основний доступ до годин — у Розкладі'), but SchedulePage's top tab switcher for hours was REMOVED (comment line 1503) and replaced with only a small text link at the very bottom of the page ('mt-8 border-t … text-center'). So a tutor who wants to set when they're available has to scroll past their whole schedule to find a quiet underlined link. During onboarding availability is step 5 (bonus), so post-onboarding it's effectively buried.

**File:** `src/pages/SchedulePage.tsx:1707`

**Fix:** Promote availability to a visible segmented tab or a prominent button in the Schedule header rather than a bottom-of-page text link, so 'set my hours' is discoverable for a first-time tutor.

### MED-15 · friction · Independent tutor

**Flow:** Schedule QuickLesson → 'Open full editor'

**Issue:** From the Dashboard, QuickLessonDialog's onWantFullForm just does `setQuickLessonOpen(false); navigate('/schedule')` — it drops the chosen time/student and dumps the user on the Schedule page with nothing pre-filled, forcing them to re-open the create form and re-enter everything. On SchedulePage itself the same callback correctly pre-fills the form, so behavior is inconsistent and the Dashboard path loses work.

**File:** `src/pages/DashboardPage.tsx:1377`

**Fix:** Pass the selected startsAt (and ideally studentId) through navigation state and open the full create dialog pre-filled, mirroring SchedulePage's onWantFullForm behavior, instead of a bare navigate.

### MED-16 · emphasis · Hub tutor + Student

**Flow:** Hub tutor → message the manager

**Issue:** "Менеджер хабу" — one of the four stated hub-tutor jobs — is a quiet full-width OUTLINE button at the very bottom of the block (L1829), below pending payments. It's the lowest-emphasis interactive element on the screen despite being a named core job, and a first-time hub tutor would likely never realize the manager is reachable from here.

**File:** `src/pages/DashboardPage.tsx:1829`

**Fix:** Promote it to a more visible affordance near the top of the hub block (e.g. a small «Написати менеджеру» pill next to the hub chip, or a teal-tinted action row), and give the button a clearer icon+label hierarchy so it reads as "contact your hub", not a generic outline button.

### MED-17 · dead-end · Hub tutor + Student

**Flow:** Student → chat with tutor (empty state)

**Issue:** A new student with no threads lands on ChatsPage's empty state (L797–806) which for non-managers says «Чати зʼявляться, коли менеджер призначить вам урок або ставку» — a pure wait-message with NO action. Yet the student CAN reach a tutor: every dashboard/schedule/profile card has a `/chats?with={tutorId}` link, and they may have a tutor already. The empty state contradicts the rest of the app and dead-ends the "message tutor" job.

**File:** `src/pages/ChatsPage.tsx:802`

**Fix:** For students who already have a tutor, surface a «Написати репетитору» action in the empty state (reuse the tutor list / first tutorId), or route them to start a thread. Keep the passive copy only for the genuinely no-tutor case.

### MED-18 · friction · Hub tutor + Student

**Flow:** Student → dashboard greeting

**Issue:** The dashboard greeting is the hardcoded static «Привіт! 👋» (uk.ts L1938, used at StudentDashboardPage L158) — no name, even though the student's first name is readily available (StudentProfilePage already loads profiles.first_name). Independent-tutor and monthly cards use «Привіт, {{name}}!» but the student — the role that most benefits from warmth — gets the impersonal version. A cold first impression on the home screen.

**File:** `src/pages/student/StudentDashboardPage.tsx:158`

**Fix:** Load the student's first_name (already cheap — one profiles read) and use a personalized «Привіт, {{name}}! 👋» plus a time-of-day variant, matching the tutor dashboard's greeting logic.

### MED-19 · intuitiveness · Hub tutor + Student

**Flow:** Student → payments

**Issue:** On StudentPaymentsPage the student sees «Очікує оплати» rows and a gold «Як оплатити» card with bank details, but there is no «Оплатити»/«Позначити оплаченим» action and no confirmation loop — payment status only flips when the manager marks it elsewhere. A first-time student reading «Очікує оплати» next to their lesson has no idea what action is expected of them or whether copying the card details is "the" step.

**File:** `src/pages/student/StudentPaymentsPage.tsx:204`

**Fix:** Add a copy-to-clipboard button on the payment-details card and a one-line explainer («Оплати за реквізитами — статус оновиться після підтвердження»), so the student understands the (hub-model) flow and gets micro-feedback (copied ✓) instead of a static block.

### MED-20 · friction · Hub tutor + Student

**Flow:** Student → loading states

**Issue:** Student pages use raw centered `Loader2` spinners (StudentDashboardPage L124/176, Schedule L70, Homework L216, Payments L226, Achievements L46) while the rest of the app standardized on skeleton loaders per CLAUDE.md. The student's home and core lists flash a lonely spinner, which reads cheaper and slower than the skeleton-based tutor/manager side.

**File:** `src/pages/student/StudentDashboardPage.tsx:175`

**Fix:** Introduce lightweight skeleton placeholders for the upcoming-lessons list, stat bubbles, and reward grid (mirroring PageSkeletons), so perceived load is faster and the experience matches the rest of the product.

### MED-21 · extra-steps · Hub tutor + Student

**Flow:** Hub tutor → see payouts (history/detail)

**Issue:** The «До виплати від хабу» card shows a single total + next date, but there is no drill-down: a hub tutor can't see WHICH lessons make up the sum, nor any history of past payouts received. If the number looks wrong, there's no recovery path or breakdown — the card is a dead-end number. PendingPaymentsCard sits below but isn't visually tied to this figure.

**File:** `src/pages/DashboardPage.tsx:1716`

**Fix:** Make the payout total tappable → a sheet listing the unpaid lessons composing it (date · student · payout) and a «Виплачено» history tab. This gives the hub tutor the transparency that makes payout trust feel "great", not just "a number".

### MED-22 · intuitiveness · First-run / onboarding

**Flow:** Hub tutor & manager — first login (no first-run at all)

**Issue:** Onboarding only fires for isIndependentTutor (DashboardPage:272). A brand-new hub tutor or manager gets no welcome, no guided setup, no empty-state coaching — they land on a dashboard that, with zero data, shows generic 'all paid / free day' empty states designed for established users. A new manager has no nudge to add their first tutor/student; a new hub tutor has no orientation to what the hub relationship means.

**File:** `src/pages/DashboardPage.tsx:271-278`

**Fix:** Add a lightweight first-run for manager (one card: 'Add your first tutor' + 'Add your first student', dismissible) and a one-screen 'how the hub works / here's your payout schedule' intro for hub tutors. Even a 2-step version of the banner would close the gap between the tutor experience and theirs.

### MED-23 · friction · First-run / onboarding

**Flow:** Sign-up — email confirmation gauntlet (non-invited tutor/student)

**Issue:** A normal self-signup goes: fill form → 'Check your email' screen (AuthPage:503) → leave app, open email, click link → return to a SECOND password-entry screen (ConfirmedSignIn, AuthPage:42) where they must re-type the password they just set. That's a full context-switch plus a redundant password entry before any value. Invited (pending) users get a slick auto-confirm fast-path (line 461-481), which proves the friction is avoidable.

**File:** `src/pages/AuthPage.tsx:402-486 (signup) and 42-136 (ConfirmedSignIn)`

**Fix:** After clicking the confirm link, exchange the code and sign the user straight in (the PKCE handler at :191-226 already creates a session and navigates to '/') — only fall back to ConfirmedSignIn if no session. Avoid asking for the password a second time. If email confirmation can be disabled for tutors, signup→first-value drops from ~5 steps to 1.

### MED-24 · emphasis · First-run / onboarding

**Flow:** Sign-up form — role selection (AuthPage signup tab)

**Issue:** The role toggle defaults to 'tutor' (AuthPage:171-174) and both role cards use identical teal-primary icon styling, so 'I am a tutor / I am a student' reads as a settings toggle rather than the single most consequential choice in the flow (it determines the entire app they'll see). A self-signup student can easily blow past it on the default and create a tutor account. The choice is visually quiet relative to its impact.

**File:** `src/pages/AuthPage.tsx:682-714`

**Fix:** Make role the visually dominant first decision: larger cards, clearer 'Which describes you?' heading, and no pre-selected default (force an explicit tap) so a student doesn't accidentally sign up as a tutor. Consider role as step 1 before name/email.

### MED-25 · friction · First-run / onboarding

**Flow:** JoinPage — invalid/expired referral link

**Issue:** An invalid referral code renders a bare card 'invalidTitle/invalidDesc' with a single 'Register' button (JoinPage:45-58). It loses all the warmth, bonus framing, and feature list of the valid invite — and silently drops the referral bonus the user was promised by whoever shared the link. A friend who clicks a slightly-stale link feels the magic evaporate with no explanation of what bonus they're missing.

**File:** `src/pages/JoinPage.tsx:45-59`

**Fix:** Keep the warm hero + bonus framing even on invalid codes ('This invite link expired, but you can still join free'). Make the CTA primary/teal to match the valid path, and consider still granting a default trial so a broken link never costs a signup.

### MED-26 · intuitiveness · First-run / onboarding

**Flow:** Invited (pending) student — first login

**Issue:** A student added by a tutor/manager exists as a ghost profile. When they try to sign in, an 'Invalid credentials' error is special-cased to bounce them to the signup tab with a toast (AuthPage:301-314). This is clever recovery, but it's reactive: the student first experiences a failure/error toast before being guided. There's no proactive 'You were invited — set your password' entry for someone arriving cold via an invite email.

**File:** `src/pages/AuthPage.tsx:300-314, 328-352`

**Fix:** Have invite emails link to /auth?signup=1&email=… (the pendingHint banner at :575 already handles this gracefully) so the invited student lands directly on a friendly 'Set your password to join {tutor}' screen instead of discovering it by failing to log in.

### MED-27 · friction · First-run / onboarding

**Flow:** Independent tutor onboarding — resume after page reload (OnboardingFlowB)

**Issue:** On reload, idx is restored from settings.onboarding_step (line 1007-1012), but the in-memory cross-step state (pickedSubjects, addedStudentId, addedStudentName, createdLessonId) resets to empty. A tutor who reloads on step 2 (lesson) loses the student-prefill chip and the lesson's student linkage; the lesson action shows no student card and may create an orphan lesson with studentId=null. The flow assumes a single uninterrupted session.

**File:** `src/components/OnboardingFlowB.tsx:999-1012, 1250-1251`

**Fix:** On resume, rehydrate addedStudentId/name/subject from the most recent independent student, and createdLessonId from the latest scheduled lesson, so a mid-flow reload doesn't drop the cross-step context (or block 'next' on lesson until a student is selected).

### MED-28 · empty-state · First-run / onboarding

**Flow:** Student dashboard — payments & homework stat bubbles for a brand-new student

**Issue:** The student dashboard shows 'Awaiting payment: 0' and a homework count bubble (StudentDashboardPage:224-238) to a student with no tutor and no lessons. For a first-time user these zero-stat tiles are noise that emphasize emptiness rather than guiding the one action that matters (get a tutor). The screen leads with stats instead of the next step.

**File:** `src/pages/student/StudentDashboardPage.tsx:224-238 (and noLessons block :166-222)`

**Fix:** For a zero-state student, suppress the stat bubbles and lead with a single hero 'Find your tutor' card. Reveal the stat bubbles only once the student has at least one tutor/lesson, so the primary action is never competing with empty counters.

### MED-29 · intuitiveness · First-run / onboarding

**Flow:** Independent tutor onboarding — Step 2 'lesson' depends on Step 1 'student'

**Issue:** LessonAction is rendered with studentId=addedStudentId, which is only set if the user completed the student step in THIS session. If a returning tutor already had a student (hasStudent auto-true) the student step shows as done and is skipped, so addedStudentId stays null and the lesson is created with student_id: null (line 326). A lesson with no student is a confusing artifact on the schedule and a weak first 'aha'.

**File:** `src/components/OnboardingFlowB.tsx:1239-1251, 320-331`

**Fix:** If addedStudentId is null at the lesson step, load the tutor's existing students and show a quick picker (or default to their single student) so the first lesson is always attached to a real student.

### MED-30 · dead-end · Navigation / IA

**Flow:** Student dashboard — no upcoming lessons

**Issue:** The student dashboard 'no lessons' state is a single flat line of muted text (studentPages.noLessons) with no forward action. A brand-new student with no booked lessons has nothing to tap — no 'find a tutor', no 'message your tutor', no next step. Contrast with SchedulePage's empty state which provides an actionLabel + onAction CTA.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/pages/student/StudentDashboardPage.tsx:178`

**Fix:** Replace the bare <p> empty state with a guided one: a short positive line plus a primary action appropriate to the student (e.g. open chat with their tutor, or a 'request a lesson / find a tutor' CTA reusing FindTutorDialog already present on the student schedule). Never leave a first-time student staring at a passive sentence.

### MED-31 · intuitiveness · Navigation / IA

**Flow:** Tutor/Manager — reaching People / My Students / Groups / Profile on mobile

**Issue:** The mobile bottom nav for tutor/manager is hard-coded to 4 items (/, /schedule, /finances, /chats — MobileBottomNav lines 66-71), but the sidebar has 7-8 (adds My Students, Groups, People, Marketing, Profile). On mobile, those extra destinations are reachable ONLY by opening the burger drawer. So a tutor must hunt through a drawer to get to 'My Students' or 'Groups' — core daily destinations that aren't in the thumb-reachable bar.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/MobileBottomNav.tsx:66`

**Fix:** Make the 4th/5th bottom-nav slot role-aware: for a tutor surface 'My Students' (or Groups); for a manager surface 'People'. A 5-item bar (the student bar already uses 5) keyed off role removes the burger detour for the most-used destination. Reserve the burger for genuinely secondary items.

### MED-32 · intuitiveness · Navigation / IA

**Flow:** Information architecture — Achievements / Availability / Subscription / Referrals

**Issue:** High-value surfaces are buried two levels deep under Profile → 'More' groups: Availability (core to a tutor being bookable) and Subscription (the monetization/upgrade surface for independent tutors) and Achievements (the retention/gamification hook) and Referrals all live only in ProfilePage's MoreSection (lines 100-139), none of them in the sidebar nav at all. A first-time independent tutor has no top-level path to upgrade, and the gamification meant to drive engagement is effectively hidden.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/pages/ProfilePage.tsx:107`

**Fix:** Promote the role-critical ones out of the junk drawer: surface Subscription/upgrade as a persistent sidebar entry (or a 'Go Pro' chip) for independent tutors, and give Achievements a sidebar slot or a visible entry point on the dashboard. Keep Audit/Paywall-metrics/Marketing in 'More' — those are genuinely secondary.

### MED-33 · emphasis · Navigation / IA

**Flow:** Sidebar / Manager — subscription requests signal

**Issue:** useSubscriptionRequestCount() is computed on every sidebar mount (AppSidebar line 112) and the badge type supports badgeKey:'subscription' (line 61), but NO nav item is ever assigned that badgeKey — so the count is calculated and thrown away. A manager has pending Pro/subscription requests with zero attention-driving surface in the nav. Meanwhile /subscription-requests is itself buried in Profile → More.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/AppSidebar.tsx:112`

**Fix:** Either surface a nav entry for subscription requests with badgeKey:'subscription' so the computed count drives attention, or remove the dead hook call. Given it's a revenue signal for managers, prefer surfacing it (e.g. on People or a dedicated requests entry) rather than deleting.

### MED-34 · friction · Navigation / IA

**Flow:** Dashboard FAB — payment quick action

**Issue:** AddFab's 'payment' action has surprising hidden logic: it pays the FIRST of today's lessons if one exists, otherwise opens the payment sheet (DashboardPage line 2305: `const first = todayLessons[0]; if (first) setWalletPair({...first...}) else openPaymentSheet()`). So tapping the same 'Add payment' button does two very different things depending on whether there's a lesson today — and when it auto-targets today's first lesson, the user never chose that student/lesson. This is non-obvious and can attach a payment to the wrong pair.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/pages/DashboardPage.tsx:2305`

**Fix:** Make the payment quick-action always open the same chooser (the RecordPaymentSheet / wallet picker) so the user explicitly selects the student/lesson. Don't silently pre-bind to todayLessons[0]; if you want a shortcut, expose it as an explicit row inside the sheet, not as the default behavior of the FAB action.

### MED-35 · friction · Navigation / IA

**Flow:** Notification bell — non-linked notifications

**Issue:** NotificationBell.handleClick marks a notification read and navigates only if n.link is truthy (lines 44-47), but notifications can have link:null (useNotifications type line 10). So tapping certain notifications does nothing visible beyond the unread dot clearing — no toast, no expand, no destination — which reads as a broken tap to a first-time user.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/NotificationBell.tsx:44`

**Fix:** For link-less notifications, give feedback: either route to a sensible default (the related entity's page) or visually mark the row as 'read' with a subtle state change / keep the popover open, so the tap clearly did something. Ideally backfill links so every notification is actionable.

### MED-36 · delight · Feel / delight

**Flow:** Achievements — badge unlock

**Issue:** Badge unlock (useBadgeUnlockToasts.ts:56) — a peak 'achievement' moment — is just a toast.success with className 'animate-pop' and a 6s duration. No confetti, no haptic, no overlay. Compare to the onboarding StepVictoryOverlay which does a full confetti + XP-float treatment for completing a single setup step. Unlocking an actual badge (a rarer, more meaningful event) gets LESS celebration than finishing an onboarding checkbox. The emphasis is inverted.

**File:** `src/hooks/useBadgeUnlockToasts.ts:55`

**Fix:** For a real badge unlock, escalate to the StepVictoryOverlay-class treatment: a confetti burst (reuse the canvas-confetti call from StepVictoryOverlay) + haptic.success() + the bigger emoji-pop card, not just a toast. Reserve toasts for the streak greeting; make the badge its own moment.

### MED-37 · intuitiveness · Feel / delight

**Flow:** Multiple — hardcoded Ukrainian in delight/celebration copy

**Issue:** Several high-visibility strings in the FEEL surfaces bypass i18n: DashboardPage.tsx:709 'Учень оплатив?' and :715 'Оплачено ✓' (the celebratory payment toast action), DashboardPage:1419 'Закрити день' / :1422 'урок чекає'/'уроки чекають' (hand-rolled pluralization) / :1426 'Одним рухом', and StudentLessonActions.tsx 'Закрити' / 'Надіслати запит' / 'Урок {lessonDate}. Запропонуйте новий час…'. This breaks en/sv locales (check-i18n would not catch inline literals) AND the hand-rolled Ukrainian plural is fragile. It also reads less considered than the warm i18n copy surrounding it.

**File:** `src/pages/DashboardPage.tsx:709`

**Fix:** Move all of these to i18n keys (e.g. tutorDelight.askPaid, tutorDelight.markPaidAction, closeDay.cardTitle/cardCount with _one/_few/_many plural forms, closeDay.oneMove; studentLessonActions.close/submitRequest/rescheduleBody). The closeDay count especially should use i18next pluralization instead of the `< 5 ? 'уроки' : 'уроків'` ternary.

### MED-38 · friction · Feel / delight

**Flow:** Global — OfflineBanner overlaps page header

**Issue:** OfflineBanner is `fixed top-0 z-[200]` mounted once in AppLayout, but the content <main> only has `pt-4`/`lg:pt-8` (AppLayout.tsx:59) with no offset for the banner's ~40px height. While offline, the banner overlays the page title / bell / burger row instead of pushing content down. The restored-banner auto-hides in 3s so it's transient, but the persistent offline state covers the header for the entire offline duration — exactly when the user is trying to read what went wrong.

**File:** `src/components/OfflineBanner.tsx:41`

**Fix:** When the persistent offline banner is showing, add top padding/margin to the layout (e.g. a body class or a spacer in AppLayout that reserves the banner height) so it pushes content down rather than covering the header. The transient 'restored' banner can stay overlaid since it's brief.

### MED-39 · emphasis · Feel / delight

**Flow:** Record payment / wallet save — cold confirmation

**Issue:** The most-repeated success microcopy in money flows is a bare 'Збережено' (uk.ts:67/917/1055/2039) — RecordPaymentSheet.tsx:177 fires `toast.success(t('recordPayment.saved'))` = just 'Збережено'. Recording a payment is a positive, money-in event; 'Saved' is the tone of a settings page, not of cash arriving. It's a missed warmth beat in the exact flow where warmth pays off (matches the app's own 'received: Отримано' which is also terse).

**File:** `src/components/RecordPaymentSheet.tsx:177`

**Fix:** Replace 'Збережено' in the payment context with a warm, specific confirmation in the house style, e.g. '💰 Оплату записано — +{amount}' or '✅ Готово! Баланс оновлено', matching the Dashboard's '💰 +{amount} від {name}!'. Keep generic 'Збережено' only for true settings saves.

### MED-40 · delight · Feel / delight

**Flow:** Evening — Close Day batch + Day-closed celebration

**Issue:** Two adjacent issues at the day's emotional climax. (1) CloseDayDialog.apply (CloseDayDialog.tsx:87) — the user just marked a whole day done+paid in one move — fires only a quiet toast, no haptic, no confetti, despite being a bigger win than completing a single lesson (which DOES get confetti on the Dashboard). (2) The DayClosedCelebration overlay (the nicest moment, with the bouncing 🌟) only triggers from the per-lesson status toggle path (DashboardPage.tsx:683), NOT from closing the day via the batch CloseDayDialog — so the user who uses the marquee 'Одним рухом' button to close their day never sees the celebration that rewards exactly that achievement.

**File:** `src/components/CloseDayDialog.tsx:87`

**Fix:** On CloseDayDialog success: fire haptic.success() + burstConfetti(), and trigger the DayClosedCelebration overlay (lift the show/count state or call onDone with a flag) so the batch-close path gets the same 🌟 moment as the incremental path. Right now the better UX path (one-tap close) is the LESS rewarding one.

### MED-41 · friction · Feel / delight

**Flow:** Student rewards shelf — loading state

**Issue:** StudentRewardsShelf.tsx:68 still uses a full-block Loader2 spinner (`flex h-40 items-center justify-center` + animate-spin) for its loading state, while the rest of the app moved to skeletons. The rewards shelf is a child-facing, delight-heavy surface (emoji collection, streak hero) — a cold spinner here is the most jarring spinner-vs-skeleton mismatch left in the app.

**File:** `src/components/StudentRewardsShelf.tsx:68`

**Fix:** Replace the Loader2 block with a lightweight skeleton matching the shelf's hero + emoji-grid shape (a SkeletonHero-style dark card + a row of rounded emoji-chip skeletons), consistent with the SkeletonCard family.

---

## DELIGHT (15)

### DELIGHT-1 · delight · Manager

**Flow:** Tutor payout — 'Виплачено' on dashboard

**Issue:** The inline 'Виплачено' button on a payout-due smart task is the best micro-interaction in the manager flow (one tap, spinner, success toast with count). But marking a tutor fully paid for the period is a meaningful, satisfying moment that passes with only a small toast — no celebration, unlike the tutor-side day-closed confetti.

**File:** `src/pages/DashboardPage.tsx:2132-2138 (payout button), 794-804 (markPayoutPaid toast only)`

**Fix:** Add a small positive moment when a payout is cleared (e.g. brief confetti or a 'Розраховано з {tutor} 🎉 {sum} ₴' celebration), reusing the existing burstConfetti/DayClosedCelebration patterns. Reinforces the most valuable manager habit.

### DELIGHT-2 · delight · Manager

**Flow:** Invite link after adding a person

**Issue:** InviteLinkDialog is excellent (🎉 medallion, copy link, ready-to-send message, resend). But after the manager finishes and taps 'Готово', they return to People with no confirmation of what's next (e.g. 'now assign a tutor'). The celebratory peak doesn't chain into the next logical step of the hub setup.

**File:** `src/components/InviteLinkDialog.tsx:209-215 (Done just closes)`

**Fix:** On close after adding a STUDENT as a manager, optionally chain into 'Призначити репетитора?' or surface a one-line follow-up toast linking to the assign flow, so the warm moment carries momentum into the next setup step.

### DELIGHT-3 · emphasis · Manager

**Flow:** Dashboard command-center hierarchy

**Issue:** The manager dashboard mixes a 192-item affirmations array (✨ phraseOfDay) and greeting prominently in the hero while the genuinely actionable 'Pending payments' and 'Що зробити далі' sit far below the fold on mobile. The affirmation is lovely but competes with the operational signal a manager opens the app to see.

**File:** `src/pages/DashboardPage.tsx:1331-1333 (affirmation in hero), 1894-1961 (pending payments lower), 2086-2168 (next steps lower)`

**Fix:** Keep the affirmation but make it secondary (smaller/quieter) and consider surfacing a one-line 'today's operational summary' (X uroks, Y неоплачено, Z запитів) directly under the greeting so the command center leads with action, not sentiment.

### DELIGHT-4 · delight · Independent tutor

**Flow:** First lesson scheduled (QuickLessonDialog success)

**Issue:** Creating a lesson — a genuine activation milestone — ends with only a sonner success toast. The app already uses confetti (onboarding) and a useHaptic hook (per CLAUDE.md), but the very first independent lesson a tutor schedules outside onboarding gets no celebration or haptic, so the moment lands flat compared to the onboarding high.

**File:** `src/components/QuickLessonDialog.tsx:374`

**Fix:** Fire useHaptic.success() on lesson create, and a small one-time confetti burst for the tutor's first-ever scheduled lesson (detectable via studentCount/first-lesson flag). Keep it subtle for subsequent lessons.

### DELIGHT-5 · emphasis · Independent tutor

**Flow:** IndependentTutorStats Pro prompt card

**Issue:** The Pro upsell card on the dashboard stats block uses a generic 'Деталі' (Details) button as its CTA. 'Details' is a weak, low-intent verb for the primary monetization entry point and competes poorly for attention against the surrounding stat cards; it reads like a footnote, not an invitation.

**File:** `src/components/IndependentTutorStats.tsx:197`

**Fix:** Change the CTA to an outcome verb ('Спробувати Pro' / 'Відкрити Pro') and give it the teal-filled emphasis already used for primary actions, so the upsell reads as a confident offer rather than a 'more info' link.

### DELIGHT-6 · delight · Hub tutor + Student

**Flow:** Student → join the call (post-lesson)

**Issue:** The reward emoji is awarded silently when the TUTOR marks the lesson complete (DashboardPage L721 inserts student_rewards with no student-facing moment). The student only discovers a new fruit later by scrolling the RewardCollection. The single best dopamine hit in the student app fires off-screen with zero celebration for the person it's meant to motivate.

**File:** `src/pages/DashboardPage.tsx:721`

**Fix:** When the student next loads the dashboard after a new reward, play a small reveal (animate the new emoji into the collection + a one-time toast «Новий бонус за урок! 🍎»). Realtime would be ideal, but even a load-time diff against last-seen rewards turns a hidden insert into a delightful moment.

### DELIGHT-7 · empty-state · Hub tutor + Student

**Flow:** Student → schedule / homework empty states

**Issue:** Empty states are inconsistent in warmth. The schedule tab empty is the flat «Поки тихо тут 📅» (uk.ts L2937) and the dashboard upcoming-list empty is bare text «☀️ Поки вільно — незабаром буде урок!» with no illustration, while Homework gets a nice 📚 illustrated card. The mixed quality makes the lighter screens feel unfinished.

**File:** `src/pages/student/StudentSchedulePage.tsx:71`

**Fix:** Give the schedule and dashboard-upcoming empty states the same illustrated, forward-guiding treatment as Homework (icon + warm line + a next step like «Знайти репетитора» when hasTutor is false), so every empty screen guides forward instead of just describing absence.

### DELIGHT-8 · delight · Hub tutor + Student

**Flow:** Student → achievements / progress

**Issue:** The achievements page and progress bar are genuinely strong (progress ring, next-badge hint, level-up + personal-record toasts). The gap to great: the dashboard's StudentProgressBar and RewardCollection are static — no "so close" nudge tying today's upcoming lesson to the next level/badge. The motivation system and the daily action live in separate blocks and never reference each other.

**File:** `src/pages/student/StudentDashboardPage.tsx:251`

**Fix:** Add a one-line bridge under the next lesson: «Ще 1 урок до рівня Експерт» using getLevelProgress, so the recurring action (attend lesson) is explicitly framed as progress toward a reward the student already cares about.

### DELIGHT-9 · delight · First-run / onboarding

**Flow:** Sign-up success → first dashboard (independent tutor)

**Issue:** The handoff from 'account created' to the onboarding flow is functional but cold: the redirect to /onboarding happens silently via sessionStorage logic. There's no welcome moment that says 'You're in, {firstName} — let's set up your tutoring in 2 minutes.' The OnboardingFlowB welcome is generic and doesn't use the name the user just typed.

**File:** `src/components/OnboardingFlowB.tsx:1226-1236 (step hero) / AuthPage.tsx:483-486`

**Fix:** Personalize the first onboarding screen with the user's first name and a warm one-liner, and add a brief 'Welcome aboard' beat (the confetti machinery already exists via burst()/StepVictoryOverlay) so the transition from signup feels celebratory, not like a silent route change.

### DELIGHT-10 · emphasis · First-run / onboarding

**Flow:** Student onboarding 'success' then 'telegram' then 'done' — three terminal screens

**Issue:** After the quiz the student taps through THREE near-identical celebration/transition screens (success 🎉 → telegram 📱 → done 🚀), each a full screen with its own Next button (StudentOnboarding:156-260). For a first-timer eager to get to value, this is three extra taps of low-information confirmation, and the Telegram step is interruptive before the student has any reason to want notifications.

**File:** `src/components/student/StudentOnboarding.tsx:130-152 (telegram), 156-171 (success), 138-152 (done)`

**Fix:** Merge success+done into one screen, and demote the Telegram connect to a dismissible card on the dashboard (offered after they have a tutor/lesson, when notifications are actually useful) rather than a mandatory pass-through screen.

### DELIGHT-11 · friction · First-run / onboarding

**Flow:** i18n / polish — hardcoded string on dashboard empty state

**Issue:** The tutor/manager 'no upcoming lessons' empty state hardcodes the Ukrainian 'Сьогодні вільний день' instead of an i18n key, which breaks the en/sv experience for a new user and violates the project's no-hardcoded-strings rule (check-i18n would not catch an inline literal). A new English/Swedish tutor sees mixed-language UI on their first dashboard.

**File:** `src/pages/DashboardPage.tsx:2005`

**Fix:** Replace the literal with a t('dashboard.freeDayToday') key added to uk/en/sv.

### DELIGHT-12 · delight · Navigation / IA

**Flow:** Notifications — mark all read

**Issue:** markAllRead (NotificationBell line 85) and notification taps have no optimistic UI or micro-feedback — the count just changes on the next render. For a bell that's styled as the app's most prominent golden accent, clearing it is a satisfying moment that currently passes silently.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/NotificationBell.tsx:85`

**Fix:** Add optimistic clearing (animate the badge to 0, fade unread highlights) and a tiny success cue (the codebase already has useHaptic success([15,50,30])). A brief 'All caught up ✨' confirmation on mark-all-read turns a utility into a small positive moment, consistent with the app's warm empty-state voice.

### DELIGHT-13 · emphasis · Navigation / IA

**Flow:** Mobile bottom nav — actionable badges

**Issue:** The tutor/manager bottom nav only shows an unread dot for /chats (MobileBottomNav line 88). The availability-request count and pending-payment signals that the sidebar surfaces (availability badge on /schedule) are invisible on mobile's primary nav, so a tutor on their phone gets no glanceable nudge toward pending availability requests or unpaid lessons on Schedule/Finances.

**File:** `/Users/oksana/Documents/GitHub/otutorhub-5/src/components/MobileBottomNav.tsx:88`

**Fix:** Mirror the sidebar's badge logic into the bottom nav: show the availability count on the /schedule tab and (optionally) a debt/unpaid indicator on /finances, using the same useAvailabilityRequestCount hook already in the app. Glanceable badges on the thumb bar are where mobile users actually decide where to tap next.

### DELIGHT-14 · delight · Feel / delight

**Flow:** First lesson ever — missing milestone moment

**Issue:** i18n has 'firstLesson'/'firstLessonDesc' achievement strings (uk.ts:1782/2150) but the very first completed lesson gets the same generic confetti+toast as the 100th. The single highest-activation moment for a new tutor (proof the app 'works', their first real lesson logged) has no special framing. The badge may fire eventually, but there's no in-the-moment 'Твій перший урок в застосунку — вітаємо! 🎉' beat tied to the completion itself.

**File:** `src/pages/DashboardPage.tsx:703`

**Fix:** On lesson-complete, detect first-ever completion (e.g. completed count was 0 before) and swap the standard toast for a one-time milestone celebration: bigger overlay or a distinct '🎉 Перший урок проведено!' toast + heavier confetti. One-time, gated by localStorage like day_closed already is.

### DELIGHT-15 · delight · Feel / delight

**Flow:** Day-closed celebration — interaction polish

**Issue:** DayClosedCelebration (DayClosedCelebration.tsx) auto-dismisses after 4000ms and dismisses on any click, but fires no haptic on appearance — the single most celebratory full-screen moment in the app arrives silently on the device. It also has no confetti (the lesser per-step onboarding victory has confetti; this bigger 'whole day done' moment does not), so the marquee moment is actually less festive than its mechanics warrant.

**File:** `src/components/DayClosedCelebration.tsx:13`

**Fix:** On show=true, fire haptic.success() and a confetti burst (reuse StepVictoryOverlay's isFinal confetti pattern) so the day-closed overlay is the app's most celebratory moment, not a silent modal. Optional: a subtle scale/glow on the 🌟 beyond animate-bounce.

