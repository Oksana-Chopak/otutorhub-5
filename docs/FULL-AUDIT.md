# oTutorHub — повний аудит застосунку

**Дата:** 2026-07-02 · **Коміт:** `cb33ef7` · **Метод:** 14 паралельних аудиторів (4 ролі + онбординг, дизайн-токени, безпека, логіка, i18n/a11y, інваріанти, нові поверхні, продуктивність, архітектура, delight) → **кожна знахідка адверсарно верифікована** проти поточного коду.

**Підсумок:** 79 узгоджених вимог-еталонів → **92 сирі знахідки → 64 підтверджені** (2 🔴 critical, 7 🟠 high, 28 🟡 med, 27 ⚪ low; з них 4 — регресії) + **15 відкинуто** як false-positive. _Delight та більшість Architecture-верифікацій впали через ліміт сесії — їх подано окремо як неверифіковані гіпотези/напрямки._

---

## ✅ Ремедіація (2026-07-03, до коміту `d6d3305`)

**Виправлено все, крім свідомо відкладеного нижче.** Кластери: безпека маржі (write-gate `20260714000000` + read-lockdown `20260715000000` — застосовані), referral-модель 21д/1міс (`20260716000000` — застосована) + вирівняне копі, early-bird RPC + лідерборд-призи + purge-прогалини (`20260717000000`), link-hardening + DB-рівнева ізоляція `lessons.source` + wallet-purge (`20260718000000`), онбординг (хаб-квіз, StudentAction→канонічний RPC, чесний Telegram-степ), i18n (дашборд, картки, 90 афірмацій, SubscriptionRequests), a11y (aria-лейбли, 13px-фікс + check-ux тепер сканує CSS), perf (chat realtime, waterfall-и Dashboard/People/Wallets), delight (конфеті відгуку/уроку, StreakCard-паритет, copy-реквізити, теплі empty-стани), DS (токени Quick-діалогів/Referrals/SubscriptionRequests, розділювачі тисяч, роль-пілюля, бінарні бейджі), спільна `src/lib/financials.ts` (замкнена тестами).

**Потребує дій Lovable:** застосувати міграції `20260717000000` і `20260718000000`; редеплой edge-функцій `notify-cancellation-fee`, `notify-lesson-update`, `scheduled-notifications`.

**Свідомо відкладено (окреме рішення/спринт):** розпил god-компонентів + roleCapabilities/спільний profiles-hook/ChatsPage-екстракція/bulk-RPC (висока регресія, нуль видимих змін); мемоізація LessonCard (заборона «Never touch»); менеджерські лічильники через RPC (LOW); ad-hoc акценти ReferralsPage (корал/індиго — дизайн-рішення власниці); 22 залишкові `(supabase as any)`; `trialTotal=30` метр для 21-денних referral-тріалів (косметика); module-level bound `t` у решті компонентів (мова підхоплюється після перезаходу).

---

## Коротка відповідь на твої питання

- **Чи немає багів?** Є — переважно medium/low, але кілька реальних (напр., картка «Учні» у незалежного репетитора завжди показує 0; подвійний блок «треба відмітити» у менеджера). Критичних логічних багів, що ламають флоу, немає.
- **Чи безпека ок?** ⚠️ **Це головна зона ризику.** Виявлено кластер витоків **маржі/цін хаба**: хаб-репетитор може прочитати `student_price` напряму з `lesson_details` (RLS рядковий, немає column-REVOKE), може **записати** ціну/статус оплати через RPC, а `AssignTutorDialog` кладе виплату репетитору в поле, яке **читає учень**. Плюс P0-діра ізоляції в групових таблицях (менеджер бачить ціни незалежних репетиторів). Це треба закрити **першочергово**.
- **Чи дизайн відповідає системі, чи всі форми оновлені?** Здебільшого так — прогрес величезний, більшість форм/сторінок усіх ролей на новому дизайні. Але міграцію на токени ще не завершено на кількох екранах із брифу (PeoplePage тощо) — лишається сирий #hex.
- **Чи швидко вантажиться / архітектура?** В цілому ок. 5 підтверджених пунктів продуктивності (послідовні запити-водоспади, .select() без limit) — варто пофіксити, але не блокери. Архітектура здорова; кілька god-компонентів/дублювань як напрямки.
- **Чи кожен флоу працює й зручний?** Так, майже всюди; окремі точки тертя (нижче).
- **Чи відчувається чудово / липко?** Фундамент сильний (скелетони, святкування, haptics, теплі порожні стани). 6 конкретних delight-можливостей, щоб підняти ще вище — в кінці звіту.

---

## 🚑 Виправити першочергово (P0/P1) — кластер приватності маржі

Ці 6 пунктів мають спільний корінь (гроші хаба протікають до репетитора/учня) і закриваються разом:

1. 🔴 **REVOKE колонок `student_price, student_payment_status, student_paid_at` на `lesson_details`** для `authenticated` (RLS рядковий не рятує) — щоб хаб-репетитор фізично не читав ціну учня.
2. 🟠 **Гардити `update_lesson_details_safe`**: колонки `student_price`/`student_payment_status` застосовувати лише для менеджера (як уже зроблено для `tutor_payout`) — щоб репетитор не міг їх **писати**.
3. 🟠 **`AssignTutorDialog`**: прибрати «виплата: X ₴» з `manager_response` (його читає учень) — лишити тільки ім'я репетитора + предмет + ціну учня.
4. 🟠 **Розсилки (scheduled-notifications)**: хаб-репетитору рахувати «зароблено» з `tutor_payout`, а не `student_price`.
5. 🔴 **P0 групова ізоляція**: додати source-scoping до 3 політик групових таблиць (`lesson_groups`, `group_enrollments`, `lesson_participants`), щоб менеджер не бачив даних незалежних репетиторів.
6. 🟠 **Дашборд хаб-репетитора**: прибрати фантомний перемикач оплати учня (точка входу до #2).

> Усі DB-фікси — новою міграцією з таймстемпом **строго вище 20260713000000** (пастка сортування) + перевірка live через anon-key probe. Далі — high-баг «Учні = 0» та неповний `purge_user_data` (лишає `referral_codes`/`referrals`/`tutor_streaks`).



---

## 🔒 Security  (10)

#### 🔴 CRITICAL — Hub tutor can read student_price / hub margin directly from lesson_details (view masking is only cosmetic; no column-level SELECT REVOKE)
*role:* hub-tutor · *area:* hub-tutor · ⏮ REGRESSION

- **Треба (ТЗ):** A hub tutor must NEVER be able to read student_price / student_payment_status (the hub's revenue; student_price − tutor_payout = the hub margin). Since Postgres RLS is row-level only, the sensitive columns must be closed with a column-level REVOKE SELECT on lesson_details for authenticated (as was done for the legacy lessons table in 20260420162548), OR reads must go exclusively through the masking view.
- **Зараз:** The financial data lives in public.lesson_details (types.ts:577-598 confirm live columns student_price/tutor_payout on lesson_details). The row-level SELECT policy `lesson_details_select_tutor` (supabase/migrations/20260616074706_...sql:6) and the RESTRICTIVE `lesson_details_restrict_direct_select` (20260620145113_...sql:3) both grant a tutor the WHOLE row when `l.tutor_id = auth.uid()` — including hub lessons. There is NO column-level `REVOKE SELECT (student_price…) ON public.lesson_details` anywhere (grep of all migrations returns only `REVOKE UPDATE ON public.lesson_details` in 20260620141443_...sql:3). The only column-level SELECT REVOKE (20260420162548_...sql:37) targets `public.lessons`, whose financial columns are now empty legacy duplicates (per the 20260612090000 hotfix comment). The lessons_visible view (20260612090000_...sql) masks student_price to NULL for hub tutors, but it is a security_invoker view over the base table — a hub tutor can bypass it with a hand-crafted `supabase.from('lesson_details').select('student_price, student_payment_status').eq('lesson_id', <own hub lesson>)` and get the real price. Commit de4c115 ('Fix hub student_price leak') only fixed the payout WRITE columns; it added no column REVOKE.
- **Доказ:** `supabase/migrations/20260616074706_88194223-2868-4197-ac22-cc5c8264ebe5.sql:6 'CREATE POLICY lesson_details_select_tutor … USING (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()))'; grep shows no 'REVOKE SELECT (student_price…) ON public.lesson_details' in any mi`
- **Наслідок:** P0 privacy/monetization breach: any hub tutor can compute the hub's per-lesson margin (student_price they now see minus their own tutor_payout), i.e. see exactly what the school marks up and what each student pays the hub — the single invariant this area is meant to protect. Undetectable via UI review because the app-layer masking looks correct.
- **Фікс:** Ship a migration (timestamp strictly above 20260713000000) that does `REVOKE SELECT (student_price, student_payment_status, student_paid_at) ON public.lesson_details FROM authenticated, anon, PUBLIC` and re-GRANT SELECT only on the non-sensitive + payout columns to authenticated, so tutors keep tutor_payout* but lose student money columns; managers read via has_role in the view / RPC. Then verify live via a hub-tutor anon-key probe that `lesson_details?select=student_price` returns null/denied. NOTE: verify applied in prod (Lovable applies migrations).

#### 🔴 CRITICAL — Hub manager reads independent tutors' group data + private pricing (P0 isolation gap in group tables)
*role:* manager · *area:* security

- **Треба (ТЗ):** Per SEC-1, a hub manager must NEVER read any independent tutor's data. The P0 fix (20260621000000) source-scoped lessons, lesson_details, student_rates and lesson_attachments to source='hub'/NULL. The group-billing tables must be scoped the same way.
- **Зараз:** The three group tables were NEVER source-scoped and were missed by every isolation migration. supabase/migrations/20260505153239_...sql:35 `CREATE POLICY "Manager manages all groups" ON public.lesson_groups FOR ALL ... USING (has_role(auth.uid(),'manager'))`, :53 `"Manager manages all enrollments" ON public.group_enrollments FOR ALL ... USING (has_role(auth.uid(),'manager'))`, and supabase/migrations/20260508080932_...sql:18 `"manager_manages_participants" ON public.lesson_participants FOR ALL ... USING (has_role(auth.uid(),'manager'))` all grant a manager blanket access with NO source / independent-workspace filter. Independent tutors DO create group lessons (src/components/QuickLessonDialog.tsx passes source:'independent' into src/lib/groupLessons.ts createGroupLesson, which inserts lesson_participants with each student's student_price and reads group_enrollments.price_per_lesson). So a pure hub manager can SELECT independent tutors' lesson_groups (names), group_enrollments (student_id + price_per_lesson) and lesson_participants (student_id + student_price = private per-student pricing).
- **Доказ:** `20260505153239_c328bd53-d413-457a-8d83-c123f770c9d4.sql:35 and :53; 20260508080932_28d5c44f-5e67-4aa9-8676-56ef2e72a824.sql:18; independent group creation in src/components/QuickLessonDialog.tsx:217+ via src/lib/groupLessons.ts (source passed through, participants inserted regardless of source). types.ts confirms lesso`
- **Наслідок:** P0 tenant-isolation breach: a hub manager reads independent tutors' students and their private group pricing — the exact class of leak SEC-1/20260621000000 was meant to close, but only closed for individual lessons/rates, not group lessons.
- **Фікс:** Add source/independent-workspace scoping to the three manager group policies, mirroring student_rates: for lesson_participants and group_enrollments join through the parent lesson/group tutor and exclude rows where the tutor's tutor_workspace_settings.independent_workspace=true (or the parent lesson source='independent'); for lesson_groups exclude groups owned by an independent-workspace tutor. Ship as a new migration timestamped above 20260713000000 (ordering trap) and verify via a manager anon-key PostgREST probe that lesson_participants/group_enrollments/lesson_groups for independent tutors return 0 rows.

#### 🟠 HIGH — AssignTutorDialog leaks hub margin (tutor_payout) to the student via manager_response
*role:* manager · *area:* manager · ⏮ REGRESSION

- **Треба (ТЗ):** A student must never be able to read tutor_payout / hub margin. Per MON-2 / SEC-4, the tutor's payout and derived margin (student_price − tutor_payout) are hub-only and must never reach a student-readable surface.
- **Зараз:** AssignTutorDialog.handleAssign writes the tutor payout into tutor_referral_requests.manager_response, and migration 20260702000000 grants the student SELECT on their own row of that table.
- **Доказ:** `src/components/AssignTutorDialog.tsx:209 responseNote includes 'Ціна для учня: ${sp} ₴, виплата: ${tp} ₴.', written at :214 'manager_response: responseNote'. supabase/migrations/20260702000000_student_reads_own_referral_requests.sql:14-18 'CREATE POLICY "students read own referral requests" ON public.tutor_referral_req`
- **Наслідок:** Any hub student who submitted a tutor request can query their own tutor_referral_requests row and read the exact tutor payout (виплата); combined with the visible student price this reveals the hub's per-lesson margin — the same class of margin leak previously flagged critical (SEC-4).
- **Фікс:** Do not embed tutor_payout in manager_response. Write a student-safe confirmation (tutor name + subject + student price only); keep payout/margin on a manager-only surface.

#### 🟠 HIGH — update_lesson_details_safe RPC lets a hub tutor write student_price / student_payment_status (no source/hub guard)
*role:* hub-tutor · *area:* hub-tutor

- **Треба (ТЗ):** Per MON-2/HUB-TUTOR-HANDOFF a hub tutor must never write student_price or student_payment_status — student→hub payment is the manager's to record. The safe RPC should apply those columns only when the caller is a manager (or the lesson source is independent, i.e. the tutor owns the money), exactly as it now gates the tutor_payout columns to managers.
- **Зараз:** The latest definition of the RPC (supabase/migrations/20260712000000_safe_rpc_manager_payout.sql, highest timestamp so it wins the CREATE OR REPLACE) authorizes any caller where `auth.uid() = v_tutor OR v_is_mgr` (line 29) and then unconditionally applies student_price (line 40) and student_payment_status (line 41) whenever present in the patch — with NO source or role guard on those columns. Only the payout columns got a `v_is_mgr AND` guard (lines 52-62). A hub tutor IS the lesson's tutor, so they pass the auth check and can write both student money fields. DashboardPage.updatePayment (src/pages/DashboardPage.tsx:779-785) calls this with `{student_payment_status:'paid', student_paid_at:…}` and has no hub-source guard (line 770-771 only skips group lessons).
- **Доказ:** `supabase/migrations/20260712000000_safe_rpc_manager_payout.sql:40-41 'student_price = CASE WHEN _patch ? 'student_price' THEN …; student_payment_status = CASE WHEN _patch ? 'student_payment_status' THEN …' (no v_is_mgr / source guard, unlike tutor_payout at lines 52-55).`
- **Наслідок:** A hub tutor can silently mark a student's debt-to-hub as paid (or alter student_price) via the RPC — corrupting the hub's receivables/margin accounting. Directly reachable today through the dashboard phantom student toggle (see next finding); also callable by hand.
- **Фікс:** In update_lesson_details_safe, gate student_price / student_payment_status / student_paid_at behind `(v_is_mgr OR EXISTS(select 1 from lessons where id=_lesson_id and source='independent'))`, mirroring the payout-column manager gate; for a hub tutor those keys must be ignored. Ship above 20260713000000 and verify. NOTE: verify applied in prod.

#### 🟠 HIGH — Hub tutor can read hub margin: student_price exposed row-level on lesson_details
*role:* hub-tutor · *area:* security

- **Треба (ТЗ):** Per MON-2, a hub tutor screen must show only hub payouts (tutor_payout) and must NEVER see student_price (RLS is row-level, so column exposure must be prevented some other way — e.g. a tutor-safe view like lesson_details_student).
- **Зараз:** supabase/migrations/20260616074706_...sql:6 `CREATE POLICY lesson_details_select_tutor ON public.lesson_details FOR SELECT ... USING (EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_details.lesson_id AND l.tutor_id = auth.uid()))` and the RESTRICTIVE guard 20260620145113_...sql:3 both grant the lesson's tutor SELECT on the WHOLE lesson_details row with no column exclusion. lesson_details carries student_price AND tutor_payout (types.ts:594/597). A hub tutor querying their own lesson's lesson_details reads student_price = the hub-margin numerator (margin = student_price − tutor_payout).
- **Доказ:** `20260616074706_88194223-2868-4197-ac22-cc5c8264ebe5.sql:6 (lesson_details_select_tutor); 20260620145113_8980a427-40df-4e6c-98b4-0c765815fdd5.sql:3 (restrict_direct_select still admits any lesson tutor); src/integrations/supabase/types.ts:594 student_price + tutor_payout on lesson_details Row.`
- **Наслідок:** A hub tutor can compute the hub's per-lesson margin on every lesson they teach, defeating the core hub monetization confidentiality (MON-1/MON-2).
- **Фікс:** Do not grant tutors raw SELECT on lesson_details. Route hub-tutor reads through a tutor-safe view/RPC that omits student_price for hub-source lessons (independent tutors keep student_price since it is legitimately theirs), or drop student_price from any tutor-facing SELECT for source='hub' lessons. Verify with a hub-tutor anon-key probe that student_price is not returned.

#### 🟠 HIGH — update_lesson_details_safe still lets the lesson's tutor (incl. hub tutor) write student_price
*role:* hub-tutor · *area:* security

- **Треба (ТЗ):** Per MON-2, hub pricing (student_price on a source='hub' lesson) must be manager-only. The RPC already gates tutor_payout to managers (v_is_mgr) — student_price should be gated the same way for hub lessons.
- **Зараз:** supabase/migrations/20260712000000_safe_rpc_manager_payout.sql:40 sets `student_price = CASE WHEN _patch ? 'student_price' THEN ...::numeric ELSE student_price END` with NO v_is_mgr check, while the authorization gate at :29 permits `auth.uid() = v_tutor OR v_is_mgr`. tutor_payout at :52 correctly requires `v_is_mgr AND _patch ? 'tutor_payout'`, but student_price does not — so the lesson's tutor (including a HUB tutor) can self-set student_price. src/components/TutorChangeRequestsCard.tsx:199 calls updateLessonDetailsSafe(lesson.id,{student_price:newPrice}) from a tutor-facing flow.
- **Доказ:** `20260712000000_safe_rpc_manager_payout.sql:29 (auth gate allows v_tutor), :40 (student_price unguarded), :52-54 (tutor_payout correctly guarded by v_is_mgr) — the asymmetry proves the omission; caller src/components/TutorChangeRequestsCard.tsx:199.`
- **Наслідок:** A hub tutor can overwrite the hub's student pricing on their own lessons (financial-integrity + margin manipulation), the same class of hole 20260701000000 closed for the direct INSERT path.
- **Фікс:** Guard student_price like tutor_payout: only apply the patched student_price when v_is_mgr, OR when the parent lesson source='independent' (independent tutors own their price). For source='hub' lessons ignore a tutor-supplied student_price.

#### 🟡 MED — Dashboard LessonCard shows hub tutors a phantom tappable 🎓 student-payment row wired to write student_payment_status
*role:* hub-tutor · *area:* hub-tutor

- **Треба (ТЗ):** Hub tutors on the dashboard should see only their own payout side (💼) — no student-price row, and certainly no tappable control that writes the student→hub payment.
- **Зараз:** In DashboardPage the upcoming/today LessonCard for a non-manager passes `showPayout={isManager || lesson.source === 'hub'}` (src/pages/DashboardPage.tsx:2313). For a hub lesson this is true, so LessonCard sets `withPayout=true` and renders BOTH PayRows (src/components/LessonCard.tsx:317-324). The student row (🎓) uses `lesson.student_price`, which lessons_visible returns as NULL for hub tutors, so formatPrice(null) renders '0 ₴' (src/lib/currency.ts:31 `Number(amount ?? 0)`). Because `onPayChange` is wired (DashboardPage.tsx:2319), that 🎓 '0 ₴ · Очікує' row is a tappable button (LessonCard.tsx:202-203, canTogglePay = !!onPayChange) that calls `updatePayment(lesson.id,'student_payment_status','paid')` → updateLessonDetailsSafe → the unguarded RPC.
- **Доказ:** `src/pages/DashboardPage.tsx:2313 'showPayout={isManager || lesson.source === "hub"}' and :2319 onPayChange wiring student→student_payment_status; src/components/LessonCard.tsx:319-320 renders the 🎓 PayRow with onToggle.`
- **Наслідок:** Confusing (₴0 student-price row that shouldn't exist for hub tutors) AND the concrete trigger for the RPC write-path breach above: one tap corrupts hub receivables. Combined with the DB read leak, the same card also proves the value is masked only in the view, not the data.
- **Фікс:** For hub tutors, do not force showPayout via source==='hub' in a way that renders the student row; either render the hub payout row through a payout-only card, or pass showPayout without enabling the student PayRow, and never wire onPayChange('student',…) for hub-source lessons. Cross-check SchedulePage for the same `source === 'hub'` showPayout pattern.

#### 🟡 MED — add_or_link_independent_student / link_student_by_email let any tutor attach to ANY existing student by email (unsolicited link + ghost reclaim)
*role:* independent-tutor · *area:* security

- **Треба (ТЗ):** A tutor should only be able to link to a student who consents / already has a relationship; attaching to an arbitrary existing account by email (and reclaiming ghost/half-created accounts) should not be a silent, unilateral action.
- **Зараз:** supabase/migrations/20260707000000_...sql add_or_link_independent_student and 20260629000000_...sql link_student_by_email are SECURITY DEFINER, only require the caller be a tutor, then resolve ANY account by `lower(pc.email)=lower(trim(_email))` and create a student_rates link (add_or_link even INSERTs a profile + 'student' role for a ghost/broken account and updates its profile_contacts phone/telegram). No check that the student ever interacted with, invited, or belongs to the calling tutor. So a tutor who knows/guesses a student's email can unilaterally attach themselves and, for orphaned profile_contacts rows, reclaim the account (writing name/role/contacts).
- **Доказ:** `20260707000000_add_or_link_student_reclaim_no_role.sql (email lookup + reclaim branch writes profiles/user_roles/profile_contacts) and 20260629000000_link_student_by_email.sql (email lookup + student_rates insert); both gated only by has_role(caller,'tutor').`
- **Наслідок:** Unsolicited tutor→student relationships and ghost-account reclaim by email enumeration; the reclaimed-account branch can overwrite a half-created account's contact data.
- **Фікс:** Require proof of relationship/consent before linking to an EXISTING real student (e.g. an accepted invite token or a pending student created by this tutor), and restrict the ghost-reclaim branch to accounts this tutor originally created (or gate reclaim behind an invite). At minimum log/notify the student on link.

#### 🟡 MED — lessons.source defaults to 'hub' and tutor/group INSERT policies have no source check (defense-in-depth isolation gap)
*role:* manager · *area:* security

- **Треба (ТЗ):** An independent tutor's lesson must always be source='independent' so managers (scoped to source='hub'/NULL) can never read it; the DB should not silently default an independent tutor's lesson to a manager-visible source.
- **Зараз:** source defaults to 'hub' (20260423114817_...sql:95 `ADD COLUMN source TEXT NOT NULL DEFAULT 'hub'`). The individual policy `Tutor creates own lessons` (20260423133857_...sql:26) and `Tutor creates own group lessons` (20260706000000_...sql:20) impose NO source predicate — only the separate `Independent tutor creates own-source lessons` policy requires source='independent'. Since the policies are OR-combined, an insert that omits source (bug or crafted request) passes the generic policy and lands source='hub', which the manager SELECT (20260621000000:lessons_select, source='hub' OR NULL) then exposes. Isolation currently relies entirely on the client always sending source (SchedulePage/QuickLessonDialog do), not on the DB.
- **Доказ:** `20260423114817_882f217a-...sql:95 default 'hub'; 20260423133857_b289fd6a-...sql:26 (no source check); 20260706000000_reissue_group_lesson_insert_policy.sql:20 (no source check); manager arm 20260621000000_p0_isolation_complete.sql lessons_select (source='hub' OR source IS NULL).`
- **Наслідок:** A single client bug or hand-crafted PostgREST insert by an independent tutor produces a source='hub' lesson visible to hub managers — the isolation guarantee is not enforced at the DB layer.
- **Фікс:** Add a RESTRICTIVE INSERT/UPDATE policy (or CHECK) so an independent-workspace tutor's lessons MUST have source='independent' (e.g. `is_independent_tutor(auth.uid()) => source='independent'`), independent of which permissive policy matched.

#### ⚪ LOW — /my-referrals has no independent-only guard — hub tutor can open the referral/subscription-invite program
*role:* hub-tutor · *area:* independent-tutor

- **Треба (ТЗ):** Per HUB-TUTOR-HANDOFF (MON-7), routes /subscription and /referrals(/my-referrals) must be hidden for hub tutors (independent_workspace=false); they see «Pro активний · від хабу», never a subscription/referral upsell.
- **Зараз:** App.tsx:203-209 guards /my-referrals only with `allowedRoles={["tutor"]}` — no independent_workspace check. MyReferralsPage.tsx has no isIndependent guard/redirect (unlike SubscriptionPage.tsx:166-170 which redirects non-independent tutors). A hub tutor navigating to /my-referrals (direct URL, back/forward, or a stale link) sees the full referral program built around the independent Pro subscription.
- **Доказ:** `App.tsx:206 '<ProtectedRoute allowedRoles={["tutor"]}>' wrapping '<MyReferralsPage />'; MyReferralsPage.tsx:68-129 has no 'useWorkspaceSettings'/isIndependent gate; compare SubscriptionPage.tsx:167 'if (!loading && user && (!roles.includes("tutor") || !isIndependent)) navigate("/", …)'.`
- **Наслідок:** Hub tutors can reach an independent-only monetization surface, contradicting the hub-tutor product model (their Pro is hub-granted, nothing to refer for) and the explicit HUB-TUTOR-HANDOFF invariant.
- **Фікс:** Add the same isIndependent redirect used in SubscriptionPage to MyReferralsPage (redirect hub tutors to '/'), matching the /subscription behavior.


---

## 🐞 Correctness & logic bugs  (17)

#### 🟠 HIGH — Independent dashboard Students stat card always shows 0 (uses manager-only studentCount, not myStudentCount)
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** The independent tutor's «Учні · активних» stat card should show the tutor's own active independent student count (myStudentCount, loaded at DashboardPage.tsx:608-614 via student_rates source='independent').
- **Зараз:** The card renders `studentCount` (DashboardPage.tsx:1556, :1599). For an independent tutor `studentCount` is set at DashboardPage.tsx:524 to `roleRows.filter(r => r.role === 'student').length`, where roleRows comes from `supabase.from('user_roles').select('user_id, role')` (:475). RLS on user_roles is only «Users view own roles» + «Manager views all roles» (migration 20260417083348_...:140,143; no tutor-scoped SELECT policy exists), so a non-manager independent tutor reads only their OWN role row → 0 student rows → the card shows 0. The correctly-scoped `myStudentCount` (:614) is loaded but only used in a smart-task (:2227), never in the stat card.
- **Доказ:** `DashboardPage.tsx:524 'setStudentCount(studentIds.length);' where studentIds = roleRows filtered to role==='student'; :1556/:1599 render '{studentCount}' in the isIndependentTutor block; :608-614 loads the correct value into 'myStudentCount' instead. user_roles RLS in supabase/migrations/20260417083348_f95dc1d3-...:140`
- **Наслідок:** The independent tutor's headline «Учні» number on the dashboard is wrong (shows 0 or an undercount) regardless of how many students they actually have — a broken core metric on the primary screen. Worse than the prior 'includes archived' report: the count is not merely inflated, it is disconnected from the tutor's students entirely.
- **Фікс:** In the isIndependentTutor stat cards (DashboardPage.tsx:1556, 1599, and any independent-only usage) render `myStudentCount ?? 0` instead of `studentCount`; keep `studentCount` for the manager grid only.

#### 🟠 HIGH — Weekly/monthly recap tells HUB tutors they «earned» the hub's student_price (revenue-model conflation, MON-2)
*role:* hub-tutor · *area:* new-surfaces

- **Треба (ТЗ):** A hub-tutor notification must never show student_price/margin; hub tutors are paid a tutor_payout by the hub, so any «Зароблено N грн» figure sent to a hub tutor must be their payout (or omitted). Recaps must distinguish hub vs independent tutors.
- **Зараз:** supabase/functions/scheduled-notifications/index.ts loops over ALL user_roles where role='tutor' (lines 107-110 monthly, 146-149 weekly) with NO independent_workspace/source filter, and for each computes income = Σ lesson_details.student_price of paid completed lessons, then sends «Зароблено: N грн» (line 134) / «Зароблено N грн за минулий тиждень 💪» (line 174). For a hub tutor, student_price is what the STUDENT pays the HUB — not the tutor's payout — so the hub's gross revenue is reported to the tutor as their own earnings.
- **Доказ:** `index.ts:116 '.select("id, lesson_details(student_price, student_payment_status)")' then :128 '.reduce((sum,d)=>sum+Number(d?.student_price ?? 0),0)' and :134 '' 'Зароблено: ${income.toFixed(0)} грн...' ''; grep for independent/source/tutor_payout in the file returns only unrelated workspace-settings reads at lines 61/`
- **Наслідок:** Hub tutors receive push/bell notifications overstating their earnings as the hub's full student revenue (leaks hub margin + misrepresents payout). Directly violates the MON-2 invariant that a hub tutor screen must show payouts and NEVER student_price/margin.
- **Фікс:** Filter the recap to independent tutors only (join tutor_workspace_settings, require independent_workspace=true) OR branch by tutor type: for hub tutors compute Σ paid tutor_payout from lesson_details instead of student_price (and reword). Do not send a student_price-derived «Зароблено» to hub tutors.

#### 🟠 HIGH — purge_user_data omits referral_codes, referrals, and tutor_streaks — self-delete leaves orphan rows despite "complete cleanup" claim
*role:* independent-tutor · *area:* new-surfaces

- **Треба (ТЗ):** The self-delete purge (called by delete-account) is documented as "a complete cleanup ... wipes all personal tables for this user"; it should delete every table keyed to the user, including referral_codes, referrals, and tutor_streaks.
- **Зараз:** supabase/migrations/20260709000000_fix_purge_user_data_drop_dead_table.sql (the live version) DELETEs 32 tables but never touches referral_codes (PK/UNIQUE tutor_id), tutor_streaks (PK tutor_id), or referrals (referrer_id/referred_id). types.ts confirms all three tables exist and key on the deleting user. So a self-deleting tutor's referral code, streak row, and referral records are left behind as orphans.
- **Доказ:** `'grep -c "referral_codes|tutor_streaks"' on both purge migrations returns 0; DELETE list (grep) shows no referral_codes/referrals/tutor_streaks. Migration header 20260708000000 claims "a complete cleanup (mirrors manager_purge_user...)". Tables verified in src/integrations/supabase/types.ts:1358 (referral_codes tutor_i`
- **Наслідок:** Incomplete PII/account erasure on App-Store-required self-delete. referral_codes.tutor_id is UNIQUE, so the orphan holds a code tied to a deleted account; referrals rows keep referrer/referred linkage after deletion. No FK to profiles (bare uuid), so it does NOT block the delete — but the erasure is genuinely incomplete, contradicting the store-compliance rationale.
- **Фікс:** Add `DELETE FROM public.referral_codes WHERE tutor_id = _user_id; DELETE FROM public.referrals WHERE referrer_id = _user_id OR referred_id = _user_id; DELETE FROM public.tutor_streaks WHERE tutor_id = _user_id;` (also check tutor_badges) to purge_user_data, in a new migration timestamped strictly above 20260713000000. Verify applied in prod.

#### 🟡 MED — Manager dashboard shows TWO duplicate 'needs marking' surfaces
*role:* manager · *area:* manager

- **Треба (ТЗ):** A manager should see one 'lessons that still need marking' surface on the dashboard.
- **Зараз:** Both the role-gated NeedsMarkingCard AND the un-role-gated needsMarkLessons LessonCard section render for managers, listing essentially the same past unmarked scheduled lessons twice.
- **Доказ:** `src/pages/DashboardPage.tsx:2079 renders NeedsMarkingCard for '(isManager || isIndependentTutor)'; :2091 '{needsMarkLessons.length > 0 && (<section>...needsMarkLessons.map(...LessonCard...)}' has NO role guard. needsMarkLessons (:1030) = scheduled & start<now; NeedsMarkingCard (NeedsMarkingCard.tsx:31-34) filters to en`
- **Наслідок:** Managers get a confusing, redundant dashboard: the same overdue lessons appear once as the compact warning card and again as full LessonCards, doubling scroll and implying two separate task queues.
- **Фікс:** Gate the needsMarkLessons LessonCard section so it does not render for managers/independent tutors (who already get NeedsMarkingCard), or remove one of the two surfaces.

#### 🟡 MED — Dashboard «До оплати» count includes cancelled-but-unpaid individual lessons that the Payments page hides → count ≠ list
*role:* student · *area:* student

- **Треба (ТЗ):** The dashboard «До оплати» tile count should equal the number of unpaid lessons the student can actually see and act on in /student/payments (both should exclude cancelled lessons, since a cancelled lesson is not payable).
- **Зараз:** Dashboard counts unpaid individual lessons straight off the `lesson_details_student` view with NO status filter and no join to lessons, so a cancelled lesson that still has student_payment_status='unpaid' is counted. The Payments page fetches individual lessons with `.neq("status", "cancelled")` and therefore never lists them. Cancellation only sets status='cancelled' and does not delete the lesson_details row, so the unpaid detail row survives.
- **Доказ:** `src/pages/student/StudentDashboardPage.tsx:96-98 'supabase.from("lesson_details_student").select("lesson_id, homework, student_payment_status")' (no status filter) and 140-142 'setPendingPaymentsCount(detailsArr.filter((d) => d.student_payment_status === "unpaid").length + unpaidGroup)'. vs src/pages/student/StudentPay`
- **Наслідок:** Student taps «До оплати» showing e.g. 3, lands on Payments showing only 2 owed lessons — an unexplained missing item that erodes trust in the money screen (owner has repeatedly flagged empty-state/count-vs-logic mismatches as bugs).
- **Фікс:** Make the dashboard count consistent with the list: filter the individual unpaid count to non-cancelled lessons (e.g. fetch lesson ids with status!=cancelled and intersect, or read lesson_details_student joined to lessons.status). The group branch already filters cancelled (line 110) — mirror that for individual.

#### 🟡 MED — Hub students (already assigned a tutor by a manager) are force-shown the "find a tutor" intake quiz
*role:* student · *area:* onboarding

- **Треба (ТЗ):** A hub student who already has an assigned tutor (student_rates source='hub' → hasTutor=true) should skip the "find a tutor" intake quiz on first login — the rest of the dashboard already respects hasTutor (the no-tutor CTA blocks at StudentDashboardPage.tsx:213 and :349 are gated on !hasTutor).
- **Зараз:** The onboarding gate is keyed ONLY on !hasQuiz and ignores hasTutor. In src/pages/student/StudentDashboardPage.tsx:78-80: `useEffect(() => { if (!ctxLoading && !hasQuiz) setShowOnboarding(true); }, [ctxLoading, hasQuiz]);`. useStudentContext returns hasTutor (destructured at line 45) but it is never consulted. A manager-assigned student with no quiz row is dropped into the "Знайти репетитора / Шукаю репетитора" quiz (StudentOnboarding, header i18n findTutor). On submit it fabricates a pointless tutor_referral_requests row and notifyManagers ping for a student who already has a tutor.
- **Доказ:** `StudentDashboardPage.tsx:79 'if (!ctxLoading && !hasQuiz) setShowOnboarding(true);' — no hasTutor guard, while lines 213/349 do gate on !hasTutor. StudentOnboarding.submit() (StudentOnboarding.tsx:108-123) inserts tutor_referral_requests + calls notifyManagers.`
- **Наслідок:** Every hub student's first session is hijacked by an irrelevant tutor-search quiz; each completion spams managers with a phantom tutor request for a student who is already matched, polluting /referrals and the dashboard smart-task.
- **Фікс:** Gate the quiz on both: `if (!ctxLoading && !hasQuiz && !hasTutor) setShowOnboarding(true);` (and add hasTutor to the dependency array). A student who already has a hub tutor should never be forced into intake.

#### 🟡 MED — Telegram onboarding step silently discards all 4 digest/reminder preferences (columns not live + stripped by RPC whitelist)
*role:* independent-tutor · *area:* onboarding

- **Треба (ТЗ):** Toggling the 4 Telegram switches (daily digest, weekly digest, 1h reminder, 15m reminder) and pressing connect should persist telegram_daily_digest / telegram_weekly_digest / telegram_reminder_1h / telegram_reminder_15m.
- **Зараз:** TelegramAction.openBot() (OnboardingFlowB.tsx:722-729) calls updateSettings({telegram_daily_digest, telegram_weekly_digest, telegram_reminder_1h, telegram_reminder_15m}). updateSettings routes through the SECURITY DEFINER RPC update_my_workspace_settings. The LIVE RPC (migration 20260619071130, a Lovable hash file = applied) UPDATE whitelist (lines 32-53) does NOT list any of the 4 telegram_* columns, so they are silently dropped. Worse, the 4 columns are absent from src/integrations/supabase/types.ts tutor_workspace_settings Row (lines 2064-2094) — i.e. they were never applied to the live DB at all (their migrations 20260603000002/000003 predate and were superseded). Both layers discard the writes with no error surfaced.
- **Доказ:** `OnboardingFlowB.tsx:723-728 passes the 4 telegram keys to updateSettings; useWorkspaceSettings.tsx:68 sends them to rpc('update_my_workspace_settings'); migration 20260619071130 lines 32-53 whitelist omits telegram_*; grep of telegram_daily_digest in types.ts returns nothing (not a live column).`
- **Наслідок:** The onboarding promise to configure Telegram digests/reminders is a no-op; the tutor believes their notification prefs are saved but nothing is persisted. Digest/reminder cron (also not live) reads defaults regardless.
- **Фікс:** Either drop the 4 toggles from the onboarding Telegram step until the columns + cron ship, or (a) apply a migration adding the 4 columns AND (b) add them to the update_my_workspace_settings whitelist in a new migration timestamped above 20260713000000. Verify via types.ts regen after apply.

#### 🟡 MED — Onboarding StudentAction bypasses the canonical add_or_link_independent_student RPC and captures no email/invite
*role:* independent-tutor · *area:* onboarding

- **Треба (ТЗ):** Adding a student should go through the canonical SECURITY DEFINER RPC add_or_link_independent_student (used by QuickAddStudentDialog.tsx:104 and MyStudentsPage.tsx:386) which handles new/existing/ghost/non-student cases atomically, captures an email, and sends send-student-invite.
- **Зараз:** OnboardingFlowB.tsx StudentAction.save() (lines 253-282) hand-rolls the exact insert dance the RPC replaced: profiles.insert with a client-side crypto.randomUUID() (line 259, 261-262), user_roles.insert (265), student_rates.insert (269), student_details.upsert (278). It has NO email field on the form at all (only name/subject/price), so it can never link an existing student account and never invokes send-student-invite. It also creates an orphan profiles row whose id is not a real auth user.
- **Доказ:** `StudentAction has inputs name/subject/price only (lines 247-249); save() does raw inserts (lines 261-278) instead of 'supabase.rpc('add_or_link_independent_student', …)' as QuickAddStudentDialog.tsx:104 does. No email captured, no send-student-invite call.`
- **Наслідок:** Onboarding-created students are second-class: no invite is ever sent, an existing student account with the same person can't be linked (duplicate ghost created), and the flow diverges from the hardened RPC path, risking RLS/edge-case breakage the RPC was built to prevent.
- **Фікс:** Add an email field to StudentAction and route the save through supabase.rpc('add_or_link_independent_student', {…}) exactly like QuickAddStudentDialog, then invoke send-student-invite when an email is provided.

#### 🟡 MED — Subject step marks itself done and advances even when the tutor_details save fails
*role:* independent-tutor · *area:* onboarding

- **Треба (ТЗ):** The subject step should only mark done / advance when the tutor_details upsert succeeds; on error it should surface a message and keep the tutor on the step (matching StudentAction/LessonAction which check the error and toast).
- **Зараз:** OnboardingFlowB.tsx SubjectAction.save() (lines 191-199) awaits `supabase.from('tutor_details').upsert({user_id, subjects}, {onConflict:'user_id'})` WITHOUT capturing or checking the returned error, then unconditionally calls onComplete(sel) → markDone(step.id) + advance(). A network/RLS failure leaves subjects unsaved while the step shows as completed (and hasSubject re-check may later flip it back to not-done, confusing state).
- **Доказ:** `OnboardingFlowB.tsx:194-198: 'await supabase.from("tutor_details").upsert({ user_id: user.id, subjects: sel }, { onConflict: "user_id" }); setSaving(false); onComplete(sel);' — no 'const { error } =' / no error branch. Contrast StudentAction.save() (lines 261-277) and LessonAction.saveLesson() (lines 388-423) which bot`
- **Наслідок:** Silent data loss: the essential first step (subjects) can report success while persisting nothing; the tutor proceeds thinking their subjects are set.
- **Фікс:** Capture the error: `const { error } = await supabase.from('tutor_details').upsert(...); if (error) { setSaving(false); toast.error(t('onboardingFlowB.subjectSaveError' or generic)); return; }` before onComplete.

#### 🟡 MED — Early-bird "X of 20 spots left" counter is RLS-blind — always shows ~19-20 for everyone
*role:* independent-tutor · *area:* logic-data

- **Треба (ТЗ):** The early-bird counter should count ALL independent tutors on active/trial across the whole system, so it decreases as real signups happen.
- **Зараз:** SubscriptionPage.tsx:194-198 counts `tutor_workspace_settings` under the caller's own anon/authenticated key: `.from("tutor_workspace_settings").select("tutor_id",{count:'exact',head:true}).eq("independent_workspace",true).in("subscription_status",["active","trial"])`. But the only SELECT RLS policy on that table is `"Tutor views own settings" ... USING (auth.uid() = tutor_id)` (migration 20260423114817:15-18), never broadened. So the count returns at most 1 (the caller's own row). earlyBirdCount is 0 or 1 → earlyBirdLeft (line 273-276) is always 20 or 19, rendered in the hero badge at line 325-328 `t("subscriptionPageExtra.earlyBirdLeft",{count: earlyBirdLeft})`.
- **Доказ:** `src/pages/SubscriptionPage.tsx:194 '.from("tutor_workspace_settings").select("tutor_id", { count: "exact", head: true }).eq("independent_workspace", true).in("subscription_status", ["active", "trial"])'; RLS: 20260423114817_...sql:15-18 'CREATE POLICY "Tutor views own settings" ON public.tutor_workspace_settings FOR SE`
- **Наслідок:** False scarcity: the '20 of 20 / 19 of 20 spots left' badge is meaningless and never moves, misleading every eligible tutor. If tutors compare notes they see the counter is fake.
- **Фікс:** Compute the count server-side via a SECURITY DEFINER RPC (e.g. get_early_bird_count()) that runs as owner and returns the true system-wide count, or drop the counter. Do not query the RLS-protected table client-side for a global aggregate.

#### 🟡 MED — Telegram deep links point at the preview domain otutorhub.lovable.app, not prod otutorhub.com
*role:* all · *area:* logic-data

- **Треба (ТЗ):** User-facing Telegram deep links should point at the production domain otutorhub.com.
- **Зараз:** notify-cancellation-fee/index.ts:89 sends `<a href="https://otutorhub.lovable.app/finances">Перейти у Фінанси</a>` and notify-lesson-update/index.ts:142 sends `<a href="https://otutorhub.lovable.app/schedule">Відкрити урок</a>`. Both are HTML links inside Telegram messages delivered to real users.
- **Доказ:** `supabase/functions/notify-cancellation-fee/index.ts:89 '+ '<a href="https://otutorhub.lovable.app/finances">Перейти у Фінанси</a>';' and supabase/functions/notify-lesson-update/index.ts:142 '+ '<a href="https://otutorhub.lovable.app/schedule">Відкрити урок</a>';'`
- **Наслідок:** Tapping the Telegram link lands users on the Lovable preview build (possibly stale/unauthenticated) instead of the prod app, hurting the payment/lesson-update follow-through and looking unprofessional.
- **Фікс:** Replace both hard-coded `https://otutorhub.lovable.app/...` links with `https://otutorhub.com/...` (or an APP_ORIGIN env var). Note these are edge functions — must be redeployed by Lovable, not shipped by Publish. Grep the other functions (auth-email-hook SAMPLE_PROJECT_URL, liqpay-create-payment allowlist) for the same string while at it.

#### 🟡 MED — purge_user_data (account delete) leaves orphaned referral, streak, badge, pro-bonus and wallet rows
*role:* independent-tutor · *area:* logic-data

- **Треба (ТЗ):** Deleting an account should remove (or intentionally anonymize) all of that user's rows; nothing keyed on the user should survive with a dangling id.
- **Зараз:** The latest purge_user_data (20260709000000) deletes many tables but NOT: public.referrals (referrer_id/referred_id uuid NOT NULL, no FK), public.referral_codes (tutor_id, no FK), public.tutor_streaks (tutor_id, no FK), public.tutor_badges (tutor_id, no FK), public.pro_bonus_ledger (tutor_id, no FK), public.student_wallet_transactions (tutor_id/student_id NOT NULL, no FK). None of these have a FK to profiles/auth.users, so deleting public.profiles (line 69) does NOT cascade them. (student_rewards IS safe — it has `student_id ... REFERENCES public.profiles(id) ON DELETE CASCADE`.)
- **Доказ:** `supabase/migrations/20260709000000_fix_purge_user_data_drop_dead_table.sql:25-69 (deletes lessons/chat/rates/workspace/etc. but never referrals/referral_codes/tutor_streaks/tutor_badges/pro_bonus_ledger/student_wallet_transactions); referrals defined at 20260430074614_...sql:28 'referrer_id uuid NOT NULL, referred_id u`
- **Наслідок:** Orphaned wallet balances (money records), referral graph, and Pro-grant ledger persist after account deletion — GDPR/data-hygiene issue and can corrupt aggregates (leaderboard, wallet balance for the remaining pair member).
- **Фікс:** Add DELETE statements to purge_user_data for referrals (referrer_id OR referred_id = _user_id), referral_codes (tutor_id), tutor_streaks (tutor_id), tutor_badges (tutor_id), pro_bonus_ledger (tutor_id), student_wallet_transactions (tutor_id OR student_id). New migration timestamped above the high-water mark.

#### 🟡 MED — FinancesPage.togglePayment fires haptic + confirmation toast AFTER awaiting the DB (violates the instant-payment-feedback invariant — the very function CLAUDE.md cites as the canonical GOOD pattern)
*role:* manager · *area:* invariants · ⏮ REGRESSION

- **Треба (ТЗ):** Per the 🔒 'Marking a payment must give INSTANT feedback' invariant, togglePayment must: optimistic UI → haptic.success() → warm toast, THEN await the DB and revert only on error. CLAUDE.md explicitly names FinancesPage.togglePayment as the canonical good pattern ('optimistic → haptic → warm 💰 toast → await → revert').
- **Зараз:** src/pages/FinancesPage.tsx:777-855 — the optimistic setLessons is at lines 788-794 (good), but then `const { error } = ... await writeStudentPayment(...) / await supabase.rpc(...)` runs at lines 796-799, and only AFTER that await does `haptic.success()` fire (line 820) and the warm `dashboardExtra.paymentReceivedToast` show (lines 839-844). There is NO haptic call between line 784 and the await at 796 (confirmed). So the tap produces a dead ~1–2s hang with no buzz and no toast until the round-trip completes — exactly the regression the invariant warns about. Note the sibling bulk handler (lines 1972-1991) and DashboardPage.updatePayment (lines 776-778, haptic BEFORE await) were both fixed to the correct order; this single-toggle path — the primary per-card mark-paid action — regressed.
- **Доказ:** `FinancesPage.tsx L788-794 optimistic setLessons; L796-799 '= await writeStudentPayment(lesson, next, nextPaidAt)'; L820 'haptic.success();'; L839 'toast.success( warm ? t("dashboardExtra.paymentReceivedToast", {...'. Contrast L1975-1979 (bulk): 'setLessons(...); haptic.success(); toast.success(...)' BEFORE 'void (async`
- **Наслідок:** The manager's single most rewarding beat — marking a student payment received — gives no instant buzz/toast; the card sits dead for the DB round-trip, then blinks + drops out of the filtered debt list, leaving the owner unsure the tap registered. This is a documented, repeatedly-regressed binding ТЗ.
- **Фікс:** Move `haptic.success()`/`haptic.tap()` and the toast (warm paymentReceivedToast for student_payment_status, calm markedAsPayout for payout) to fire immediately after the optimistic setLessons at line 794, before the `await` at 796. On error, revert the optimistic state, haptic.error(), toast.error — mirroring the bulk handler at L1975-1990 and DashboardPage.updatePayment at L776-790. Keep the Undo action on the optimistic toast.

#### ⚪ LOW — Dashboard 'lessons without meeting link' count and its target Schedule filter disagree
*role:* manager · *area:* manager

- **Треба (ТЗ):** Clicking the 'N lessons without a link' task should land on a list of exactly those N lessons.
- **Зараз:** The dashboard count uses effectiveMeetingUrl (honors per-pair default_meeting_url), but the Schedule nolink filter it links to only checks raw lesson.meeting_url and does not even fetch defaults, so the two sets diverge.
- **Доказ:** `src/pages/DashboardPage.tsx:1056-1063 counts with '!effectiveMeetingUrl(l)' (falls back to default_meeting_url at :1050-1054) and links to '/schedule?view=list&filter=nolink' (:1312). src/pages/SchedulePage.tsx:877 '.filter((l) => l.status !== "cancelled" && !l.meeting_url)' and :345 select omits default_meeting_url.`
- **Наслідок:** A lesson with no explicit link but a configured pair default is NOT counted on the dashboard yet DOES appear in the Schedule nolink list — the manager sees a different (larger) list than the badge promised.
- **Фікс:** Make the SchedulePage nolink filter honor effective-URL logic (fetch default_meeting_url, treat a default as 'has link'), or change the dashboard count to raw meeting_url so both agree.

#### ⚪ LOW — False-promise copy: "Учень отримає запрошення приєднатися" but the onboarding never captures an email or sends an invite
*role:* independent-tutor · *area:* onboarding

- **Треба (ТЗ):** Copy must match the code's actual behavior (CLAUDE.md quality bar rule 4: message text must match the query/logic).
- **Зараз:** OnboardingFlowB.tsx:308 renders studentInviteNote = "Учень отримає запрошення приєднатися до твого кабінету." ("The student will receive an invitation to join your workspace"), but StudentAction has no email input and never calls send-student-invite (see the bypass finding), so no invitation is ever sent.
- **Доказ:** `i18n uk.ts:3814 'studentInviteNote: "Учень отримає запрошення приєднатися до твого кабінету."'; StudentAction.save() (OnboardingFlowB.tsx:253-282) sends nothing to the student.`
- **Наслідок:** The tutor is told an invite went out; it never does, so the student never gets access and the tutor doesn't know they must invite them separately.
- **Фікс:** Fix the underlying flow (capture email + send invite) so the copy is honest, or change the copy to reflect that the student is added locally without an invite.

#### ⚪ LOW — New logged-in user with no roles yet is routed to the tutor/manager dashboard, not the student dashboard
*role:* all · *area:* onboarding

- **Треба (ТЗ):** A freshly-authenticated user whose roles have not yet resolved (roles === []) should not be dropped onto the tutor/manager /dashboard, which loads manager/tutor data surfaces.
- **Зараз:** Index.tsx:19-21 computes isStudentOnly = roles.includes('student') && !manager && !tutor; with an empty roles array this is false, so it Navigates to /dashboard (tutor/manager) rather than /student-dashboard. This can briefly happen right after signup/confirm before user_roles propagates.
- **Доказ:** `Index.tsx:19 'const isStudentOnly = roles.includes("student") && !roles.includes("manager") && !roles.includes("tutor");' then line 21 'Navigate to={isStudentOnly ? "/student-dashboard" : "/dashboard"}'.`
- **Наслідок:** Edge-case flash of the wrong dashboard for a role-less user; low because handle_new_user assigns a role and DashboardPage guards loadData on roles.length>0, so it self-corrects on the next render.
- **Фікс:** Treat roles.length===0 as an unresolved/neutral state (e.g. render a loader until roles resolve) rather than defaulting to the tutor/manager dashboard.

#### ⚪ LOW — DashboardPage.markPayoutPaid awaits the RPC before the optimistic UI update and toast (same await-first anti-pattern as togglePayment, on the payout-out path)
*role:* manager · *area:* invariants · ⏮ REGRESSION

- **Треба (ТЗ):** Per the same instant-feedback invariant ('Any mark paid/received action MUST update the UI optimistically first'), marking a tutor's payout paid should update the UI + toast optimistically, then await and revert on error.
- **Зараз:** src/pages/DashboardPage.tsx:835-844 — markPayoutPaid does `await supabase.rpc("mark_tutor_payouts_paid", ...)` at L837, then only after the await shows `toast.success(...)` (L843) and updates `setLessons(...)` (L844). No optimistic update and no haptic. This is the lower-priority OUT-payout path (manager → hub tutor), but it's the same pattern the invariant targets.
- **Доказ:** `DashboardPage.tsx:837 'const { data, error } = await supabase.rpc("mark_tutor_payouts_paid" ...)'; L843 'toast.success(...)'; L844 'setLessons((prev) => prev.map(...))' — all after the await; no haptic anywhere in the function.`
- **Наслідок:** Marking a tutor payout paid hangs for the RPC round-trip before any confirmation, a milder instance of the dead-tap problem on a secondary path.
- **Фікс:** Optimistically flip the tutor's unpaid payout rows + fire haptic.success() + toast before the await; revert on error. Lower priority than the FinancesPage.togglePayment fix but the same treatment.


---

## 🎨 Design-system conformance  (12)

#### 🟡 MED — Manager Finances summary/analytics stats render money without thousands separators
*role:* manager · *area:* manager

- **Треба (ТЗ):** Money is formatted with locale separators (handoff spec `₴ 86 200`); the rest of FinancesPage uses `.toLocaleString(getLocale())`.
- **Зараз:** The manager summary stat grid and profit-trend total render raw numbers (e.g. `86200 ₴`).
- **Доказ:** `src/pages/FinancesPage.tsx:2348 'value={'${totalIncome} ₴'}', :2352 '${totalExpense} ₴', :2358 '${profit} ₴', :2365 '${totalDebt} ₴', :2525 '${profitSparkline.reduce(...)} ₴' — all missing '.toLocaleString(getLocale())', unlike :1595/:1814/:1846 which use it.`
- **Наслідок:** For a hub with tens of thousands ₴ of income/profit, the headline summary cards show unreadable run-together digits (e.g. `128450 ₴`), inconsistent with every other money figure on the page.
- **Фікс:** Wrap each value in `.toLocaleString(getLocale())` for lines 2348, 2352, 2358, 2365, 2525.

#### 🟡 MED — Early-bird «залишилось N місць» pill can never show to the trial users it targets
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** The early-bird seats pill on SubscriptionPage should appear for eligible new Pro tutors (the trial audience it is meant to nudge).
- **Зараз:** SubscriptionPage.tsx:273-276 gates `earlyBirdLeft` on `eligibleForTrial`, defined at :265 as `!settings?.trial_until && status === 'free' && !isActive`. New independent tutors are provisioned with subscription_status='trial' AND trial_until set (signup grant `now() + interval '30 days'`, migration 20260521180319_...:89 and the applied 20260619071130_...:68). So a trial user has trial_until != null and status='trial' → eligibleForTrial is false → earlyBirdLeft is null → the pill (rendered only at :325 `earlyBirdLeft !== null`) never renders for them; it also can't show for active subscribers.
- **Доказ:** `SubscriptionPage.tsx:265 'const eligibleForTrial = !settings?.trial_until && status === "free" && !isActive;'; :273 'const earlyBirdLeft = eligibleForTrial && earlyBirdCount !== null && … ? … : null;'; :325 '{earlyBirdLeft !== null && (…)}'. Signup trial grant sets trial_until in migration 20260619071130_...:68.`
- **Наслідок:** The scarcity nudge (first-20 Pro seats), whose whole purpose is to convert trial users, is dead code for the trial audience — it renders for essentially nobody.
- **Фікс:** Loosen the gate so the pill shows for trial users too, e.g. show it when `isTrial || (status==='free' && !isActive)` while earlyBirdCount < limit; keep hiding it once the user is on an active paid sub.

#### 🟡 MED — ReferralsPage fully off-token — 51 raw hex, only 1 token class, incl. hardcoded brand teal and ad-hoc accents
*role:* all · *area:* design-tokens

- **Треба (ТЗ):** REFERRALS-HANDOFF + brief: ReferralsPage tokenized like the rest (primary tokens for teal, text-muted-foreground for grey, success/warning for status).
- **Зараз:** ReferralsPage.tsx has 51 raw hex and exactly 1 token-class usage — the most off-token screen relative to its size. It hardcodes brand teal `#2BBFAA`(5)/`#25a896`(5)/`#1f8e7e`, greys `#0f0f1a`(9)/`#b0b4c8`(3)/`#6b7088`/`#9aa0b4`/`#7b8198`, plus ad-hoc one-off accents `#FF7A59`, `#8B5CF6`, `#5b6bf5`, `#F59E0B` that don't map to any documented token.
- **Доказ:** `grep hex on ReferralsPage.tsx: '9 #0f0f1a', '5 #eceef3', '5 #2BBFAA', '5 #25a896', '3 #b0b4c8', '2 #F59E0B', '2 #6b7088', plus singletons '#FF7A59 #8B5CF6 #5b6bf5 #22c55e #16a34a #1a1a3e'. Token-class count = 1. Prior audit measured 3 hex here — it has grown to 51.`
- **Наслідок:** Referrals screen visually diverges from the design system and introduces colors (coral #FF7A59, indigo #5b6bf5) outside the token palette, so brand-teal and success/warning states can't be themed centrally.
- **Фікс:** Tokenize ReferralsPage: teal→primary tokens, greys→text-foreground/text-muted-foreground, borders→border-border, and reconcile the ad-hoc accents to the documented accent set (violet #7c3aed for Pro, amber for pending, green success) or add named tokens if a new accent is truly needed.

#### 🟡 MED — Referral friend-trial term: every rendered copy promises 21 days but the applied claim_referral() grants 30
*role:* independent-tutor · *area:* logic-data

- **Треба (ТЗ):** The friend-trial length shown to users must match what claim_referral() actually grants, and must be internally consistent across the app.
- **Зараз:** The live claim_referral() (latest/high-water-mark migration 20260622000000:50, also 20260619175146:183 and 20260517165711:41) does `PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', ...)` — 30 days. But EVERY rendered UI copy promises 21 days: MyReferralsPage line 302 renders `myReferrals.rewardLineBold1` = uk.ts:1447 "21 день пробного періоду" / en.ts:1437 "a 21-day trial"; ReferralNudgeBanner line 60 renders `referralBanner.bonus` = uk.ts:1510 "21 день Pro другу за реєстрацію"; OnboardingFlowB line 922 renders `referralBadgeFriend` = uk.ts:3892 "+21 день другу" / en.ts:3880 "+21 days for a friend". So the friend is promised 21 but receives 30.
- **Доказ:** `supabase/migrations/20260622000000_referral_and_notification_hardening.sql:50 'PERFORM public.grant_pro_days(_new_user, 30, 'referral_signup_referred', ...)' vs uk.ts:1447 'rewardLineBold1: "21 день пробного періоду"' / uk.ts:3892 'referralBadgeFriend: "+21 день другу"' / uk.ts:1510 'bonus: "21 день Pro другу за реєстр`
- **Наслідок:** Referral marketing term is wrong on every screen a tutor sees. Either the copy is stale (should say 30) or the grant is wrong (should be 21). A monetization term that doesn't match delivered value is a trust/legal risk and confuses the growth loop.
- **Фікс:** Decide the canonical friend-trial length (code currently delivers 30). If 30 is correct, update rewardLineBold1, referralBanner.bonus, referralBadgeFriend, bonusDesc, step2Desc, inviteText, shareText2 in all 3 locales from 21→30. If 21 is correct, change grant_pro_days(_new_user, 30,...) to 21 in the live claim_referral (new migration timestamped above the high-water mark). Do it in one pass across uk/en/sv.

#### ⚪ LOW — MarketingPage help text is duplicated and one line contradicts actual send behavior
*role:* manager · *area:* manager

- **Треба (ТЗ):** One accurate help line under the HTML body field.
- **Зараз:** Two consecutive paragraphs both start 'Підтримується HTML'; the second ('Порожній рядок = новий абзац') describes the preview's \n→<br> transform, not the real send path, which the code comment says sends htmlBody as-is.
- **Доказ:** `src/pages/MarketingPage.tsx:177-182 two '<p>' help blocks; preview at :60-62 does 'htmlBody.replace(/\n/g, '<br>')' while :59 notes 'actual send uses htmlBody as-is'.`
- **Наслідок:** Manager marketing tool shows redundant, partly-misleading guidance about how newlines/HTML are handled.
- **Фікс:** Merge into a single accurate line and remove the contradictory 'empty line = new paragraph' claim (or make the send path match it).

#### ⚪ LOW — /my-referrals has no independent-only guard — hub tutor reaching it by URL sees the independent Pro-referral program (MON-7 violation)
*role:* hub-tutor · *area:* hub-tutor

- **Треба (ТЗ):** Per HUB-TUTOR-HANDOFF (MON-7) the /referrals and /subscription routes must be hidden/blocked for hub tutors (independent_workspace=false); Pro-referral mechanics are an independent-subscription concept only. SubscriptionPage already enforces this by redirecting non-independent tutors (src/pages/SubscriptionPage.tsx:167-170).
- **Зараз:** The /my-referrals route is guarded only by `allowedRoles={['tutor']}` (src/App.tsx:203-209), and MyReferralsPage has NO isIndependent/useWorkspaceSettings guard — it doesn't even import useWorkspaceSettings (src/pages/MyReferralsPage.tsx top imports). A hub tutor navigating to /my-referrals by URL sees the full referral program (step copy '1 місяць Pro за кожного друга, що оплатив підписку'), a subscription mechanic that does not apply to them.
- **Доказ:** `src/App.tsx:204-208 '<ProtectedRoute allowedRoles={["tutor"]}><MyReferralsPage /></ProtectedRoute>'; MyReferralsPage.tsx has no isIndependent redirect (contrast SubscriptionPage.tsx:167 'if (!loading && user && (!roles.includes('tutor') || !isIndependent)) navigate('/')').`
- **Наслідок:** Hub tutors can reach and interact with an independent-only monetization surface, breaking the two-model separation (MON-1/MON-7). Lower severity because the dashboard hides the referral task for hub tutors (DashboardPage.tsx:1205) and the sidebar doesn't link it — it's only reachable by direct URL.
- **Фікс:** Add the same isIndependent redirect to MyReferralsPage that SubscriptionPage has (redirect hub tutors to /), or add an independentOnly guard to the /my-referrals route.

#### ⚪ LOW — Referral reward described 3 contradictory ways (45d/30d/21d trial; 249₴/30d/1-month Pro) across shared copy
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** Per baseline MON-4 / CLAUDE.md Referral Flow: referred friend gets a 21-day Pro trial; referrer gets 1 month Pro per friend who subscribes. All referral surfaces must state the same offer.
- **Зараз:** referralWidget.desc: uk = «Друг отримує 45 днів тріалу · ти — 249 грн за кожного» (uk.ts:2233); en = «Friend gets 30 trial days · you get 30 days for each referral» (en.ts:2222) — uk and en disagree with each other AND both contradict the 21-day / 1-month-Pro spec. referralBonusVal = «+249 UAH per friend» (en.ts:915, sv.ts:685) frames the referrer reward as 249₴ cash, not a Pro month. onboardingFlowB.referralDesc/referralLongDesc correctly say «21 days trial … free month» (en.ts:2525,2581). MyReferralsPage UI uses the correct 21-day/Pro keys, but the shared widget/onboarding copy is wrong and mutually inconsistent.
- **Доказ:** `uk.ts:2233 'desc: "Друг отримує 45 днів тріалу · ти — 249 грн за кожного"'; en.ts:2222 'desc: "Friend gets 30 trial days · you get 30 days for each referral"'; en.ts:915 'referralBonusVal: "+249 UAH per friend"'; contrast uk.ts:1447 'rewardLineBold1: "21 день пробного періоду"' used on MyReferralsPage.`
- **Наслідок:** Independent tutors and their referred friends see conflicting promises (45 vs 30 vs 21 days; 249₴ cash vs 1 month Pro) depending on which surface they hit — a monetization-integrity bug that can create support disputes over unfulfilled cash/day promises.
- **Фікс:** Normalize every referral string to the single spec: friend = 21-day Pro trial, referrer = 1 month Pro per paid friend (3 paid in a month → +3 months). Fix uk/en/sv referralWidget.desc + referralBonusVal to remove the 45-day / 30-day / 249₴-cash wording; keep check-i18n green.

#### ⚪ LOW — StudentProfilePage hero is missing the required «🎓 Учень» role pill from the handoff
*role:* student · *area:* student

- **Треба (ТЗ):** STUDENT-CABINET-HANDOFF §7 Профіль: «Герой: аватар, імʼя, email, пілюля "🎓 Учень".» — the profile hero must show a student role pill.
- **Зараз:** The identity card renders only avatar + displayName + email (lines 145-159); there is no «🎓 Учень» role pill anywhere on the page. (The generic role label lives only in the AppSidebar footer, not on the profile hero the handoff specifies.)
- **Доказ:** `src/pages/student/StudentProfilePage.tsx:145-159 identity card — '<p ...>{displayName}</p>' then '<p ...>{user?.email}</p>', no role pill element; grep for '🎓'/'roles.student' in the file returns nothing.`
- **Наслідок:** Minor spec gap vs the approved handoff; the student's role is not surfaced on their own profile, unlike the design.
- **Фікс:** Add a small teal/violet pill «🎓 Учень» (i18n key, e.g. reuse roles.student) under/next to the name in the identity card, matching studentkit.jsx.

#### ⚪ LOW — Locked achievement tiles render a 0/1 progress bar for binary (target=1) badges, contradicting the catalog's own contract
*role:* student · *area:* student

- **Треба (ТЗ):** studentAchievements.ts documents the contract explicitly: `target` "when 1 the achievement is binary (no progress bar shown)" (StudentAchievementResult, lines 30-34). Binary badges (first_lesson, first_homework, early_bird) should not show a progress bar.
- **Зараз:** StudentAchievementsGrid renders a progress bar + `current / target` label for EVERY unearned badge regardless of target, so an unearned binary badge shows a 0%-filled bar and «0 / 1» — the exact case the catalog says should have no bar.
- **Доказ:** `src/lib/studentAchievements.ts:33-34 doc + 'binary = (value) => ({ ..., target: 1 })' (61-65). src/components/student/StudentAchievementsGrid.tsx:108-125 unconditionally renders '<div class="h-1.5 ... rounded-full">' bar and '{Math.min(current,target)} / {target}' for all '!earned' tiles.`
- **Наслідок:** Cosmetic/UX inconsistency: a binary 'do it once' badge looks like a partially-completed multi-step goal («0 / 1»), which is confusing for the 3 binary achievements.
- **Фікс:** In StudentAchievementsGrid, gate the progress bar + have/need label on `target > 1` (show only the criterion text for binary badges), per the catalog contract.

#### ⚪ LOW — SubscriptionRequestsPage hardcodes status-pill colors and headings inline (27 hex) instead of destructive/success/warning/foreground tokens
*role:* manager · *area:* design-tokens

- **Треба (ТЗ):** SUBSCRIPTION-HANDOFF / brief: status states → text-warning/text-success/text-destructive; headings → text-foreground; grey → text-muted-foreground.
- **Зараз:** SubscriptionRequestsPage.tsx carries 27 raw hex with only 5 token classes: status pills hardcode `#b4740b`(warning, x2), `#b3441f`(destructive, x2), `#16a34a`(success), while headings/borders use raw `#0f0f1a`(5), `#eceef3`(6), `#6b7088`(3), `#2BBFAA`(3). Prior audit measured 19 hex; now 27.
- **Доказ:** `grep hex on SubscriptionRequestsPage.tsx: '6 #eceef3', '5 #0f0f1a', '3 #6b7088', '3 #2BBFAA', '2 #b4740b', '2 #b3441f', '1 #16a34a', '1 #6b7280', '1 #25a896'.`
- **Наслідок:** Status pills and headings don't track tokens; the amber/red/green states can't be themed centrally and the grey/heading colors miss the token/WCAG fixes.
- **Фікс:** Map `#b4740b`→text-warning/bg-warning, `#b3441f`→text-destructive, `#16a34a`→text-success, `#0f0f1a`→text-foreground, `#6b7088`→text-muted-foreground, `#eceef3`→border-border, teal→primary tokens.

#### ⚪ LOW — Dead referral i18n keys still carry a contradictory model (45-day trial + flat 249₴ cash reward)
*role:* independent-tutor · *area:* logic-data

- **Треба (ТЗ):** Stale/unused i18n copy that contradicts the real terms should be removed so it can't be re-wired by mistake.
- **Зараз:** referralWidget.desc (uk.ts:2233 "Друг отримує 45 днів тріалу · ти — 249 грн за кожного"), onboardingExtra.referralDesc (uk.ts:2536) and referralLongDesc (uk.ts:2592) describe a 45-day trial and a flat 249₴ cash reward per friend — contradicting both the code (30-day trial + 1 month Pro, no cash) and the rendered 21-day copies. These keys are never rendered (grep of src shows only referralWidget.copy/share/inviteText/etc. consumed; referralWidget.desc/title/savedLabel and onboardingExtra.referral* have zero call sites).
- **Доказ:** `src/i18n/locales/uk.ts:2233 'desc: "Друг отримує 45 днів тріалу · ти — 249 грн за кожного"', uk.ts:2536 'referralDesc: "...45 днів тріалу, а ти — 249 грн в подарунок."', uk.ts:2592 referralLongDesc; en.ts:2222 'desc: "Friend gets 30 trial days · you get 30 days for each referral"' — three different models across dead k`
- **Наслідок:** Low now (not rendered), but a future dev re-wiring these keys would surface a 45-day / cash-reward promise that the system never delivers. Also inflates i18n and hides the true term.
- **Фікс:** Delete the unused referralWidget.desc/title/savedLabel and onboardingExtra.referralDesc/referralLongDesc/referralTitle keys from all 3 locales (only add/remove in sync so check-i18n stays green), or repoint them to the canonical term.

#### ⚪ LOW — MarketingPage renders two contradictory duplicate HTML-help paragraphs under the body textarea
*role:* manager · *area:* new-surfaces

- **Треба (ТЗ):** One clear helper line under the HTML-body textarea.
- **Зараз:** src/pages/MarketingPage.tsx shows two stacked <p> both starting «Підтримується HTML.»: line 177-179 says «Підтримується HTML. Привітання та футер з посиланням на відписку додаються автоматично.» and line 180-182 says «Підтримується HTML. Порожній рядок = новий абзац.» The repeated «Підтримується HTML.» reads as a copy/paste leftover; the second claim («empty line = new paragraph») also doesn't match the send path (send uses htmlBody as-is; only the PREVIEW replaces \n with <br>, per the comment on line 58-59).
- **Доказ:** `Lines 177-182 quoted above; the send() path (line 110) passes raw htmlBody with no newline-to-paragraph conversion, while previewHtml (line 60-61) does 'htmlBody.replace(/\n/g,'<br>')' — so the second paragraph's promise is only true in preview, not in the actual email.`
- **Наслідок:** Confusing/contradictory guidance for the sender; minor polish + a subtly inaccurate claim about newline handling.
- **Фікс:** Collapse to a single accurate helper line; either implement newline→<br> in the send path too or drop the «Порожній рядок = новий абзац» claim.


---

## ⚡ Performance & load  (5)

#### 🟡 MED — PeoplePage load is a 3-stage serial waterfall and fetches up to 2000 lessons + all profiles/roles/rates unbounded on every visit
*role:* manager · *area:* performance

- **Треба (ТЗ):** Independent queries should run in one Promise.all; the recent-lessons scan should be bounded/paginated, and profiles/user_roles/student_rates should not be pulled in full for large hubs.
- **Зараз:** PeoplePage.tsx:236 runs a Promise.all of 6 unbounded selects (profiles, profile_contacts, user_roles, tutor_details, student_rates, tutor_subject_rates — none has a .limit). Only AFTER that resolves does line 250-254 fire a SECOND serial query `supabase.from('lessons').select('id, tutor_id, student_id, starts_at, status').order('starts_at',{ascending:false}).limit(2000)`, and only after THAT resolves does line 267 fire a THIRD stage of chunked lesson_details queries. So the page pays 3 sequential network round-trips before it can render, and pulls up to 2000 lesson rows + every profile/role/rate row each visit.
- **Доказ:** `src/pages/PeoplePage.tsx:237 'supabase.from("profiles").select("id, first_name, last_name, is_pending, avatar_url, archived_at, created_at")' (no limit); :250-254 '.from("lessons").select(...).order("starts_at",{ascending:false}).limit(2000)'; :267-273 chunked '.from("lesson_details").select(...).in("lesson_id", chunk)`
- **Наслідок:** On a mature hub (thousands of lessons/profiles) the People page has a slow, growing time-to-interactive: ~3 serial latencies plus a 2000-row transfer + a full lesson_details join every open. Payment-status aggregates are recomputed client-side each visit.
- **Фікс:** Move the lessons query into the initial Promise.all (it doesn't depend on the profile batch). Bound the recent-lessons window (e.g. last N months instead of last 2000 rows) or push the unpaid-count/last-interaction aggregation into a SQL view/RPC so the client doesn't transfer 2000 lessons + their details just to compute per-person badges.

#### ⚪ LOW — DashboardPage loadData runs 4-5 role-gated queries sequentially after the initial batch instead of parallelizing them
*role:* manager · *area:* performance

- **Треба (ТЗ):** After the first Promise.all, the independent follow-up queries for a manager (three head-count queries, tutor_details payout schedule, its profiles, group-participants) should be batched into as few round-trips as possible since most don't depend on each other.
- **Зараз:** loadData does a good initial Promise.all (line 463), but then a manager serially awaits: the 3-count Promise.all at line 528, THEN the tutor_details payout-schedule query at line 589, THEN a dependent profiles query at line 595, plus the group-participants query at line 578 — each its own awaited round-trip. These blocks (528, 578, 587) are independent of one another yet run one after another.
- **Доказ:** `src/pages/DashboardPage.tsx:528 'const [{count:trCount},...] = await Promise.all([...])'; :578 'const { data: gParts } = await supabase.from('lesson_participants')...'; :589 'const { data: sched } = await supabase.from('tutor_details').select(...).not('payout_frequency','is',null)'; :595 'const { data: profs } = await `
- **Наслідок:** Manager dashboard first paint waits on ~4 serial latencies that could largely overlap; adds hundreds of ms of avoidable wait on higher-latency mobile connections every dashboard open.
- **Фікс:** Fold the independent manager follow-ups (the 3 counts, the group-participants lookup, and the tutor_details schedule) into the initial Promise.all or a single second Promise.all; only the schedule->profiles lookup is a true dependency.

#### ⚪ LOW — DashboardPage manager path pulls all user_roles and all student_rates with no limit purely to derive counts
*role:* manager · *area:* performance

- **Треба (ТЗ):** Simple counts (tutor count, student count, students-without-tutor) should use head:true count queries or a bounded aggregate, not transfer every row.
- **Зараз:** In the initial Promise.all, line 475 `supabase.from('user_roles').select('user_id, role')` and line 480 `supabase.from('student_rates').select('student_id')` are both unbounded full-table selects whose only use is to compute tutorIds.length, studentIds.length and the set of students without a tutor (lines 521-552). profiles is capped at limit(300) but roles/rates are not.
- **Доказ:** `src/pages/DashboardPage.tsx:475 'supabase.from("user_roles").select("user_id, role")'; :480 'isManager ? supabase.from("student_rates").select("student_id") : ...' — no .limit; consumed only as '.length' and Set membership at :521-552.`
- **Наслідок:** Row transfer grows linearly with hub size for data that is only counted; wasteful payload on every dashboard load for a large school.
- **Фікс:** Use `{ count: 'exact', head: true }` queries for the tutor/student counts, and compute students-without-tutor via an RPC/view rather than shipping every user_roles + student_rates row to the client.

#### ⚪ LOW — LessonCard is not memoized and receives a fresh object + many inline handlers per row, so every list re-render re-renders all cards
*role:* all · *area:* performance

- **Треба (ТЗ):** List item components rendered in potentially long lists (Schedule/Dashboard) should be React.memo'd with stable props so unrelated state changes (filters, a single card's optimistic update) don't re-render the whole list.
- **Зараз:** LessonCard is exported as a plain `export function LessonCard(...)` (src/components/LessonCard.tsx:99, no React.memo). At the Schedule render site each card gets `lesson={{ ...lesson, currency: pairCurrency[...] }}` (new object every render) plus ~8 inline arrow handlers (onStatusChange, onPayChange, onContentClick, onEdit, onCopy, onDelete). Any parent state update re-renders every visible card and rebuilds all these props.
- **Доказ:** `src/components/LessonCard.tsx:99 'export function LessonCard({' (no memo); src/pages/SchedulePage.tsx:1686-1728 — 'lesson={{ ...lesson, currency: ... }}' and inline '(s)=>updateStatus(...)', '(field,paid)=>updatePayment(...)', '()=>setDetailsLessonId(lesson.id)', etc. per item.`
- **Наслідок:** On long schedules the whole visible list re-renders on each keystroke in a filter, tab switch, or single-card optimistic payment toggle; minor jank on low-end phones but capped by pastLimit slicing.
- **Фікс:** Wrap LessonCard in React.memo and stabilize the per-row props (memoize the currency-augmented lesson and hoist the handlers to useCallback keyed by lesson.id, or pass lesson.id + a single onAction callback) so only the changed card re-renders. Note CLAUDE.md marks LessonCard 'never touch' — coordinate before editing.

#### ⚪ LOW — WalletsPage loads in a 3-step serial chain where the balances query has no dependency on the earlier steps
*role:* manager · *area:* performance

- **Треба (ТЗ):** Independent queries (student_rates pairs and wallet balances) should run in parallel; only the profiles lookup truly depends on the pairs result.
- **Зараз:** WalletsPage.loadData runs strictly sequentially: step 1 `student_rates` (line 52-59, awaited), step 2 `profiles.in(ids)` (66-69, depends on step 1), step 3 `student_wallet_balances.select('*')` (78-81, awaited) — step 3 is independent of steps 1-2 but still runs after them, and select('*') is unbounded.
- **Доказ:** `src/pages/WalletsPage.tsx:59 'const { data: rates } = await ratesQ;' then :66 profiles then :78-81 'supabase.from("student_wallet_balances").select("*")' awaited last.`
- **Наслідок:** Extra serial round-trip on the wallets page open; unbounded balances transfer for large hubs. Low traffic page so limited blast radius.
- **Фікс:** Run the rates and balances queries together in a Promise.all, then fetch profiles for the resulting ids; select explicit balance columns instead of '*'.


---

## 🏗 Architecture  (2)

#### 🟡 MED — Local hex-token objects (const F={...}) in QuickLessonDialog & QuickAddStudentDialog duplicate the CSS tokens with raw hex, embedding the failing #9398b0
*role:* independent-tutor · *area:* design-tokens

- **Треба (ТЗ):** Brief: use the existing CSS tokens; don't invent/duplicate color values. Local per-file palettes should reference the design-system tokens, not re-declare raw hex.
- **Зараз:** QuickLessonDialog.tsx:387-393 and QuickAddStudentDialog.tsx:154-160 each declare a private `const F = { teal:'#2BBFAA', tealD:'#25a896', tealL:'#f0fdf9', border:'#eceef3', bg:..., txt:'#0f0f1a', sub:'#9398b0', muted:'#b0b4c8', ...}` object that hardcodes the entire palette (including the WCAG-failing #9398b0 and a non-token border #eceef3 instead of --border #f0f1f5). These objects are why both dialogs show 0 token classes despite 41/33 hex.
- **Доказ:** `QuickLessonDialog.tsx:387 'const F = { teal: "#2BBFAA", tealD: "#25a896", tealL: "#f0fdf9", border: "#eceef3", bg: "#F5F4F0", surface: "#fff", txt: "#0f0f1a", sub: "#9398b0", muted: "#b0b4c8", ... }'; QuickAddStudentDialog.tsx:154 near-identical with 'border: "#eceef3", bg: "#fbfbfc"'.`
- **Наслідок:** Two divergent private palettes drift from the canonical tokens (wrong border color, failing muted color), so central token/WCAG fixes never reach these dialogs; the structural LESSON-FORM redesign shipped but the color layer did not.
- **Фікс:** Delete the const F objects and reference tokens (className text-primary/text-muted-foreground/border-border etc.), or at minimum point sub→#6b7088 and border→var(--border); keeps handlers/state intact per brief rule 6.

#### 🟡 MED — Hub-margin/income/expense/profit formula duplicated ~10x across FinancesPage & DashboardPage instead of one shared lib
*role:* manager · *area:* architecture

- **Треба (ТЗ):** MON-2's `profit = Σ paid student_price − Σ paid tutor_payout` (and the paid/unpaid/billable filters) computed once in a shared, unit-tested lib (e.g. src/lib/financials.ts) and reused everywhere.
- **Зараз:** The identical reduce-over-lessons formula is re-implemented verbatim at FinancesPage.tsx:614-620 (totalIncome/totalExpense/profit), 621-627 (pending), 636-637 (computeMarkup), 662-684 (profitSparkline) AND DashboardPage.tsx:951-957 (totalIncome/totalExpense/profit), 969-973 (prevMonthProfit), 997-1003 (monthlyProfitBars). Each page also defines its OWN `billable` filter — FinancesPage `periodBillable` vs DashboardPage `billableLessons` (DashboardPage.tsx:941-948) differ subtly.
- **Доказ:** `FinancesPage.tsx:620 'const profit = totalIncome - totalExpense;' and DashboardPage.tsx:957 'const profit = totalIncome - totalExpense;' — same code, plus 6+ more filter+reduce copies of 'Number(l.student_price)' / 'Number(l.tutor_payout)'.`
- **Наслідок:** The margin formula is the hub's core revenue calculation (MON-2). Divergent `billable` predicates mean Dashboard and Finances can show different profit for the same data, and a fix to one is silently missed in the other — exactly the class of bug the owner flags. No single test can lock the formula.
- **Фікс:** Create src/lib/financials.ts exporting computeFinancials(lessons, {periodStart}) → {income,expense,profit,pendingIncome,pendingExpense,markup}; a shared isBillable(lesson) predicate; replace all ~10 inline copies. Lock with one test.

> ⚠️ **Нижче — кандидати з архітектури, які НЕ пройшли адверсарну верифікацію (впав ліміт сесії). Розглядати як гіпотези, перевірити перед фіксом.**

#### 🟠 HIGH — God-components: FinancesPage (2838), DashboardPage (2600), PeoplePage (2125), SchedulePage (1800) mix fetching, role logic, money math and view
*role:* all · *area:* architecture

- **Треба (ТЗ):** Page components stay thin: data-fetching in hooks, business math in libs, presentation in child components. No single .tsx over ~600 lines.
- **Зараз:** src/pages/FinancesPage.tsx=2838, DashboardPage.tsx=2600, PeoplePage.tsx=2125, SchedulePage.tsx=1800, ChatsPage.tsx=1569 lines. Each embeds its own supabase queries, role-flag derivation, financial aggregation, and JSX. 446 direct `.from(` calls live in pages/components vs only 32 in hooks — data access is almost entirely un-encapsulated. DashboardPage alone holds 12 `as any` casts and ~11 raw supabase calls.
- **Доказ:** `wc -l src/pages/*.tsx: 2838 FinancesPage.tsx / 2600 DashboardPage.tsx / 2125 PeoplePage.tsx. 'grep -c .from( ' totals: pages+components 446 vs hooks 32.`
- **Наслідок:** Every money/role change forces edits in multiple 2000+ line files; the owner's recurring cross-role regressions (dashboard notes position, optimistic payment, hub-tutor column leaks) trace directly to logic being copied per-page instead of shared. High cognitive load + merge conflicts (main is edited by Claude + Lovable + owner in parallel).
- **Фікс:** Extract per-page data hooks (useDashboardData, useFinances, useScheduleData) and split JSX into section components. Prioritize FinancesPage/DashboardPage. Move all `.from(lessons...)` money reads behind one hook.

#### 🟠 HIGH — Three inconsistent data-access strategies for the same money-bearing lessons data (server-view vs client-strip)
*role:* all · *area:* architecture

- **Треба (ТЗ):** One canonical way to read lessons + money columns with hub-tutor column stripping, used by every surface.
- **Зараз:** DashboardPage.tsx:466 and SchedulePage.tsx:344 read the `lessons_visible` VIEW and rely on it to strip tutor_payout/student_price server-side for hub tutors. FinancesPage.tsx:292-294 bypasses the view entirely, querying raw `lessons` + `lesson_details!inner` and stripping columns CLIENT-side via `const indDetailCols = isHubTutor ? "tutor_payout,..." : "student_price, tutor_payout,..."` (line 277-279). So the hub-margin-isolation invariant (MON-2/SEC-4) is enforced two different ways depending on the page.
- **Доказ:** `DashboardPage.tsx:466 '.from("lessons_visible")'; SchedulePage.tsx:344 '.from("lessons_visible")'; FinancesPage.tsx:293-294 '.from("lessons")…lesson_details!inner(${indDetailCols})' with client-side isHubTutor branch at :277.`
- **Наслідок:** A security-critical isolation rule (hub tutor must NEVER see student_price/margin) has two enforcement paths; if the `lessons_visible` view CASE and the FinancesPage client string ever drift, one surface leaks margin while the other doesn't. Reviewers must audit two mechanisms. Client-side column selection is weaker defense-in-depth than the view.
- **Фікс:** Standardize on `lessons_visible` (server-side stripping) for FinancesPage too, or centralize the money read in one hook that always uses the view; delete the isHubTutor client-string branch.

#### 🟡 MED — roleCapabilities.ts declared 'SINGLE SOURCE OF TRUTH' but used once; role flags are hand-derived per page
*role:* all · *area:* architecture

- **Треба (ТЗ):** Per its own header comment, cross-cutting role visibility gates through canSee()/isIndependentTutor()/isHubTutor() from src/lib/roleCapabilities.ts, not raw flags scattered across pages.
- **Зараз:** roleCapabilities.ts is imported by exactly ONE file (ProfilePage.tsx) and canSee() is called exactly ONCE (ProfilePage.tsx:682, setupGuide). Meanwhile the role predicate is copy-pasted: DashboardPage.tsx:229-231, FinancesPage.tsx:156/161, WalletsPage.tsx:38, SchedulePage.tsx:153 each redefine `const isIndependentTutor = isTutor && !isManager && isIndependent`. DashboardPage derives `isHubTutor = ... && !isIndependentTutor` while FinancesPage uses `!isIndependent` — cosmetically inconsistent.
- **Доказ:** `'grep canSee(' → only ProfilePage.tsx:682. 'grep roleCapabilities' import → only ProfilePage.tsx. DashboardPage.tsx:229 'const isIndependentTutor = isTutor && !isManager && isIndependent;' duplicated in 4 pages.`
- **Наслідок:** The abstraction built specifically to stop the app's #1 bug class (role logic written for one tutor type, missing for the other) is bypassed everywhere it matters. The role-capabilities test locks a matrix almost no page consults, giving false confidence.
- **Фікс:** Export a useRoleFlags() hook returning {isManager,isTutor,isIndependent,isStudent} + the derived isIndependentTutor/isHubTutor from roleCapabilities, and replace the 5 hand-rolled derivations. Route feature gating through canSee().

#### 🟡 MED — Live, fully-typed RPCs/tables are called through `(supabase as any)`, disabling type checking (schema-drift mask)
*role:* all · *area:* architecture

- **Треба (ТЗ):** RPCs/tables present in generated types.ts are called with the typed client so wrong arg names / shapes fail tsc.
- **Зараз:** All 5 RPCs called via `(supabase as any).rpc(...)` — update_my_workspace_settings, is_superadmin, update_lesson_details_safe, tutor_delete_student, start_manager_chat — ARE in src/integrations/supabase/types.ts (verified: each `IN types.ts`). Worse, src/lib/notifications.ts:5 does `const db = supabase as any` for the WHOLE module citing 'notifications table is new and not yet in generated types', but the notifications table, create_notification and notify_managers are all now present in types.ts. So the casts are stale and blanket.
- **Доказ:** `src/lib/notifications.ts:3-5 '// …not yet in generated types. const db = supabase as any;' — yet grep confirms notifications table + create_notification + notify_managers are all in types.ts. lessonDetailsSafe.ts:33 '(supabase as any).rpc("update_lesson_details_safe"…)' where types.ts:2551 fully types it.`
- **Наслідок:** A typo in `_user_id`/`_patch`/`_lesson_id` or a future signature change would compile clean and fail only at runtime. types.ts:2549 shows start_manager_chat `Args: never` — the `as any` at DashboardPage.tsx:221 hides that too. Defeats the whole point of the generated types and the DEPLOY-1 'in types.ts = live' verification trick.
- **Фікс:** Drop the `as any` on these 5 RPC calls and the module-level `db` alias in notifications.ts; call `supabase.rpc(name, args)` directly and fix any surfaced type mismatch. Delete the stale comment.

#### 🟡 MED — 'Load all profiles/user_roles then join client-side' pattern duplicated across 6+ pages with no shared hook
*role:* all · *area:* architecture

- **Треба (ТЗ):** A shared hook (e.g. useDisplayNames(ids) / useProfilesMap) resolves user_id→name once; pages don't each re-implement fetch-all + Map build.
- **Зараз:** `supabase.from("profiles").select("id, first_name, last_name")` (often `.limit(300)` or `.in("id", ids)`) is re-issued independently in DashboardPage.tsx:474, SchedulePage.tsx:350, FeedbackInboxPage.tsx:53, MyReferralsPage.tsx:119, ReferralsPage.tsx:113, SubscriptionRequestsPage.tsx:71, plus PeoplePage.tsx:237. Likewise `from("user_roles").select("user_id, role")` in DashboardPage:475, SchedulePage:352, PeoplePage:241, ChatsPage:223 — each then builds its own name/role Map inline.
- **Доказ:** `DashboardPage.tsx:474 & SchedulePage.tsx:350 identical 'from("profiles").select("id, first_name, last_name").limit(300)'; user_roles fetched raw in 4+ pages.`
- **Наслідок:** Duplicated fetch + Map-building logic; the `.limit(300)` cap silently truncates name resolution for larger hubs (>300 profiles) in a scattered way that must be fixed page-by-page. Inconsistent — some pages `.in(ids)`, some fetch-all.
- **Фікс:** Add a useProfileNames(ids?) hook + a useUserRolesMap() hook (or a lightweight cache) and replace the ad-hoc fetches; drop the fragile `.limit(300)`.

#### ⚪ LOW — updateLessonDetailsSafeBulk fans out N sequential RPC calls instead of one bulk RPC
*role:* all · *area:* architecture

- **Треба (ТЗ):** A bulk lesson_details update issues one round-trip (single RPC accepting an id array), matching the comment's intent of replacing `.in("lesson_id", ids).update(patch)`.
- **Зараз:** src/lib/lessonDetailsSafe.ts:41-49 `updateLessonDetailsSafeBulk` does `Promise.all(lessonIds.map((id) => updateLessonDetailsSafe(id, patch)))` — one network RPC per lesson. For a manager bulk-marking a full month of payouts this is dozens of parallel round-trips, and partial failure leaves an inconsistent set (it returns only the first error, others already committed).
- **Доказ:** `lessonDetailsSafe.ts:46 'const results = await Promise.all(lessonIds.map((id) => updateLessonDetailsSafe(id, patch)));'`
- **Наслідок:** Bulk payment/payout marking (a core manager action) is O(N) round-trips and non-atomic — some lessons flip, then a mid-batch failure surfaces one error while the rest silently succeeded, confusing reconciliation.
- **Фікс:** Add a SECURITY DEFINER RPC update_lesson_details_safe_bulk(_lesson_ids uuid[], _patch jsonb) applying the same whitelist in one transaction; call it from the bulk helper.

#### ⚪ LOW — ChatsPage embeds ~9 raw supabase reads + realtime channel wiring directly in the component
*role:* all · *area:* architecture

- **Треба (ТЗ):** Chat thread/message loading + realtime subscription encapsulated in a useChatThreads/useChatMessages hook (as notifications/unread already are in hooks/).
- **Зараз:** ChatsPage.tsx (1569 lines) inlines loadThreads (145), manager-role lookups (223, 347), message load with attachments+reactions (409-462), and two realtime `supabase.channel(...)` subscriptions with manual removeChannel cleanup (462-538). This is the only major list surface with no data hook, unlike useNotifications/useUnreadChats which already exist.
- **Доказ:** `ChatsPage.tsx:145 loadThreads, :462 'const channel = supabase.channel(...)', :516 second channel — all inline in the page.`
- **Наслідок:** Realtime subscription/cleanup logic living in a 1500-line component is error-prone (leaked channels on route change) and untestable; inconsistent with the rest of the app that has hooks for chat-adjacent data.
- **Фікс:** Extract useChatThreads() and useChatMessages(threadId) hooks owning the queries + channel lifecycle; ChatsPage renders from their return values.


---

## 🌐 i18n / localization  (14)

#### 🟡 MED — RecordPaymentSheet hardcodes ₴ and ignores the student's currency
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** Payment amounts in the record-payment sheet should render in the student's actual currency (UAH/USD/EUR), as WalletDialog already does.
- **Зараз:** RecordPaymentSheet renders every amount via recordPaymentExtra.priceUah = «{{price}} ₴» (uk.ts:3270) and recordPaymentExtra.ratePerLesson = «{{rate}} ₴/ур.» (uk.ts:3279). The `UnpaidLessonOption` and `PairOption` types (RecordPaymentSheet.tsx:24-39) carry no currency field, and the sheet uses these keys at :248, :327, :417 with no currency branch. WalletDialog by contrast picks the symbol from student_rates.currency (WalletDialog.tsx:166, :332).
- **Доказ:** `RecordPaymentSheet.tsx:248 '{formatDate(l.starts_at)} · {t("recordPaymentExtra.priceUah", { price: l.student_price })}'; :417 't("recordPaymentExtra.ratePerLesson", { rate: p.rate })'; uk.ts:3270 'priceUah: "{{price}} ₴"'.`
- **Наслідок:** An independent tutor whose student is billed in USD/EUR sees the amounts labeled with ₴ in the payment-recording sheet, misstating what the student owes — inconsistent with WalletDialog and with the multi-currency model.
- **Фікс:** Add a `currency` field to PairOption/UnpaidLessonOption, thread it from the callers (DashboardPage pairCurrency / FinancesPage), and format via a currency-aware symbol like WalletDialog does instead of the hardcoded ₴ keys.

#### 🟡 MED — StudentPaymentsPage uses a module-level bound t() instead of useTranslation — text does not re-render on language switch
*role:* student · *area:* student

- **Треба (ТЗ):** Per i18n rules, all student pages localize via useTranslation() so switching UA/EN/SV via the sidebar LanguageSwitcher instantly re-renders the page (consistent with every other student page: Dashboard/Schedule/Homework/Profile all use useTranslation()).
- **Зараз:** StudentPaymentsPage.tsx binds a static translator at module scope: `import i18nInstance from "@/i18n"; const t = i18nInstance.t.bind(i18nInstance);` (lines 9-10). This captures the language active at first import; the component has no react-i18next subscription, so changing language leaves the whole page in the old language (titles «До оплати»/«Оплачено», status pills, «Як оплатити», empty states) until a full remount/reload.
- **Доказ:** `src/pages/student/StudentPaymentsPage.tsx:9-10 'import i18nInstance from "@/i18n"; const t = i18nInstance.t.bind(i18nInstance);' — used throughout render (e.g. line 162 't("studentPages.paymentsTitle")', 193 't("studentPages.toPay")'). No 'useTranslation()' call in the component (contrast StudentDashboardPage.tsx:43 'c`
- **Наслідок:** A student who changes app language on the Payments page sees a stale-language screen — the only student page that fails to react to the language switch, an obvious inconsistency for a multilingual (uk/en/sv) product.
- **Фікс:** Replace the module-level bound `t` with `const { t } = useTranslation();` inside the component (import from react-i18next), matching the other four student pages. Remove the `i18nInstance` import.

#### 🟡 MED — DashboardPage smart-tasks, trial banner, close-day & streak copy are hardcoded Ukrainian (not translated for en/sv)
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** All user-facing strings go through t(); en/sv managers/tutors see English/Swedish. Note this file is EXCLUDED from scripts/check-hardcode.mjs entirely (line ~111: dashCount subtracted), so the gate never catches it.
- **Зараз:** Many manager/tutor dashboard strings are inline Ukrainian literals with hand-rolled Cyrillic plural suffixes, so en/sv users see raw Ukrainian. Confirmed no matching keys exist in en.ts/sv.ts. Examples in src/pages/DashboardPage.tsx: line 1231-1234 payout task `час виплати` / `Позначити виплаченим`; 1256 `запит... на репетитора`; 1270 `на підписку`; 1284-1287 `нове звернення`/`Переглянути`; 1296 `без репетитора`; 1322 & 1335 request titles; trial chip 1433-1435 `Пробний період... Підключити за 249 ₴/міс`; trial banner 1482-1492; close-day banner 1507-1514 `Закрити день`/`Одним рухом`; streak 1631 `Серія` + 1634 day plural.
- **Доказ:** `src/pages/DashboardPage.tsx:1231-1234, 1256-1258, 1270-1272, 1284-1287, 1296-1298, 1322-1324, 1335-1337, 1433-1435, 1482-1492, 1507-1514, 1631-1634. grep of en.ts/sv.ts for Закрити день / Одним рухом / Пробний період закінчується / Час виплати returns nothing.`
- **Наслідок:** English and Swedish managers/independent tutors see the core dashboard action list, trial upsell, close-day CTA and streak label in Ukrainian only. This is the primary landing surface for every role, so the whole non-uk experience looks half-translated.
- **Фікс:** Move each inline string to an i18n key in uk/en/sv and use t() with count-based pluralization (like the sibling tasks at 1310/1348 already do via dashboardPageExtra.lessonsWithoutLink / lessonsWithoutPrice). Keep the intentional dayAffirmations array (lines ~109-190) Ukrainian-only.

#### 🟡 MED — TelegramLinkCard mixes t() with hardcoded Ukrainian UI strings
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** Every visible label goes through t(); en/sv users see translated text.
- **Зараз:** Toasts/titles use t() (lines 102, 119, 167, 209) but the loading text, error state, connected state, action buttons and instructions are hardcoded Ukrainian. src/components/TelegramLinkCard.tsx:108 `Перевірка статусу Telegram...`, 135 `З'єднання перервано`, 138 bot-blocked desc, 143 `Відновити`, 147/161 `Відʼєднати`, 154 `Telegram підключено`, 157 desc, 183 `Натисніть «Start»`, 200 `Код діє 30 хвилин`, 204 `Новий код`, 211 desc.
- **Доказ:** `src/components/TelegramLinkCard.tsx:108,135,138,143,147,154,157,161,183,200,204,211`
- **Наслідок:** Independent tutors on en/sv setting up Telegram notifications see mixed English-toast / Ukrainian-body UI, and cannot understand the connect/reconnect instructions.
- **Фікс:** Extract all these literals to telegramLink.* keys across uk/en/sv and replace with t(). Some sibling keys (telegramLink.connected/connecting/loading) already exist.

#### 🟡 MED — GoogleCalendarCard has hardcoded Ukrainian title, connected state and disconnect button
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** All labels translated via t().
- **Зараз:** Toasts and the connect button use t() (lines 40,45,61,77,80,112) but the card description, connected label and disconnect button are hardcoded Ukrainian. src/components/GoogleCalendarCard.tsx:93 `Уроки автоматично з'являтимуться у вашому Google Календарі.`, 104 `✓ Підключено`, 108 `Відключити`.
- **Доказ:** `src/components/GoogleCalendarCard.tsx:93,104,108`
- **Наслідок:** en/sv tutors see the Google Calendar integration card described and its disconnect button in Ukrainian.
- **Фікс:** Add googleCalendar.cardDesc / .connectedLabel / .disconnectBtn keys to uk/en/sv and replace the literals with t().

#### 🟡 MED — DashboardPage 'today lessons' header and empty-day use hardcoded Ukrainian plus a broken plural hack
*role:* independent-tutor · *area:* i18n-a11y

- **Треба (ТЗ):** Header/label localized; plural forms correct.
- **Зараз:** src/pages/DashboardPage.tsx:2209 builds the independent tutor header as `🗓️ ${"Сьогодні"} · ${todayLessons.length} ${"урок".slice(0, ...)}` — hardcoded 'Сьогодні' and a slice() hack that only ever yields 'урок'/'урок'/'уроки' (never the correct 'уроків' for 5+). Line 2246 hardcodes `Сьогодні вільний день`.
- **Доказ:** `src/pages/DashboardPage.tsx:2209, 2246`
- **Наслідок:** en/sv tutors see the today-lessons section header/empty text in Ukrainian, and even Ukrainian users get wrong pluralization for 5+ lessons ('5 уроки' instead of '5 уроків').
- **Фікс:** Use t('dashboard.today') / a count-based i18n plural key and drop the .slice hack; localize the free-day line.

#### ⚪ LOW — Smart-task 'students without a tutor' uses a broken plural (always 'ів')
*role:* manager · *area:* manager

- **Треба (ТЗ):** Ukrainian noun should decline by count: 1 → 'учень', 2-4 → 'учні', 5+ → 'учнів'.
- **Зараз:** All three ternary branches return 'ів', so count===1 renders '1 учнів без репетитора' (grammatically wrong) and the ternary is dead code.
- **Доказ:** `src/pages/DashboardPage.tsx:1296-1298 '${studentsWithoutTutor} учн${ studentsWithoutTutor === 1 ? "ів" : studentsWithoutTutor < 5 ? "ів" : "ів" } без репетитора'`
- **Наслідок:** Manager dashboard smart-task shows ungrammatical Ukrainian for the common 1-student case; inconsistent with sibling tasks (запит/и/ів) that decline correctly.
- **Фікс:** Return 'ень' for 1, 'і' for 2-4, 'ів' for 5+ (or use an i18n plural key like the other counts).

#### ⚪ LOW — SubscriptionRequestsPage ships hardcoded Ukrainian strings instead of i18n keys
*role:* manager · *area:* manager

- **Треба (ТЗ):** All UI strings go through i18n keys synced across uk/en/sv (project i18n rule).
- **Зараз:** The page title, description, response label, message label and the three action buttons are hardcoded Ukrainian literals while the rest of the page uses t().
- **Доказ:** `src/pages/SubscriptionRequestsPage.tsx:136 'Запити на підписку', :139 description, :224 'Повідомлення', :233 'Ваша відповідь', :278 'Взяти в роботу', :289 'Завершити', :299 'Відхилити'.`
- **Наслідок:** These manager-facing strings never localize to en/sv and are invisible to check-i18n key-sync since they are literals, diverging from the codebase's i18n convention.
- **Фікс:** Move each literal to an i18n key (e.g. subscriptionRequests.*) and add uk/en/sv translations.

#### ⚪ LOW — Independent desktop dashboard bento hardcodes Ukrainian «Дохід» / «Учні»
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** All UI strings go through i18n keys (no hardcoded literals), so en/sv render correctly.
- **Зараз:** The isIndependentTutor desktop bento hardcodes Ukrainian: DashboardPage.tsx:1571 `💰 Дохід` and :1595 `Учні`, instead of using t('dashboard.cardProfit')/t('dashboard.cardStudents') as the mobile/manager cards do (:1527, :1666, :1687).
- **Доказ:** `DashboardPage.tsx:1571 '💰 Дохід'; :1595 'Учні'; compare mobile independent card :1527 '{t("dashboard.cardProfit") || "Твій дохід"}'.`
- **Наслідок:** An en/sv independent tutor sees Ukrainian labels on the desktop dashboard stat cards.
- **Фікс:** Replace the two hardcoded literals with the existing t('dashboard.cardProfit') and t('dashboard.cardStudents') keys.

#### ⚪ LOW — DashboardPage independent-tutor onboarding tasks (TUTOR_BONUS_TASKS) are hardcoded Ukrainian
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** The 'What to do next' setup task titles/descriptions are translated per locale.
- **Зараз:** The whole TUTOR_BONUS_TASKS array is inline Ukrainian. src/pages/DashboardPage.tsx:1162-1163 `Встанови доступні години`; 1170-1171 Zoom/Meet; 1178-1179 Google Calendar; 1186-1187 `Запросіть колегу`; 1194-1195 AI notes.
- **Доказ:** `src/pages/DashboardPage.tsx:1158-1199`
- **Наслідок:** New independent tutors on en/sv see their onboarding checklist (the 'Que to do next' section) entirely in Ukrainian.
- **Фікс:** Move each task's title/desc to i18n keys and read them via t() when building the array (compute inside render/useMemo so language switches apply).

#### ⚪ LOW — DashboardPage invite-nudge block hardcoded Ukrainian (title/body/CTA/aria-label) and negative framing
*role:* independent-tutor · *area:* i18n-a11y

- **Треба (ТЗ):** Localized copy; empty/nudge states use positive framing.
- **Зараз:** src/pages/DashboardPage.tsx:1772 `Ви ще не запросили учня` (negative 'ще не'), 1774 body, 1778 button `Запросити зараз`, 1787 aria-label `Прибрати нагадування` — all hardcoded.
- **Доказ:** `src/pages/DashboardPage.tsx:1772-1791`
- **Наслідок:** en/sv tutors see this reminder card in Ukrainian; the title also leads with negation contrary to the positive-framing rule.
- **Фікс:** Extract to i18n keys, localize the aria-label, and reframe the title positively (e.g. reuse the canonical 'Time to meet your first student' tone).

#### ⚪ LOW — MyStudentsPage active empty state uses negative 'немає'-framing title
*role:* independent-tutor · *area:* i18n-a11y

- **Треба (ТЗ):** Empty-state titles use warm/positive framing per the mandatory rule (canonical noStudents = 'Час познайомитись з першим учнем! ... 🚀').
- **Зараз:** The primary active empty state title is negative across all 3 locales: uk.ts:1254 emptyActiveTitle `У вас поки немає власних учнів`; en.ts:1244 'You have no independent students yet'; sv.ts:1234 'Du har inga självständiga elever än'. Rendered at src/pages/MyStudentsPage.tsx:717.
- **Доказ:** `src/pages/MyStudentsPage.tsx:717; src/i18n/locales/uk.ts:1254 / en.ts:1244 / sv.ts:1234`
- **Наслідок:** The first thing a brand-new independent tutor sees leads with 'you have no students', violating the mandatory positive-framing empty-state rule (the description CTA is already positive).
- **Фікс:** Reword emptyActiveTitle to a positive greeting across uk/en/sv (e.g. 'Time to meet your first student').

#### ⚪ LOW — Student dashboard date cell hardcodes Ukrainian 'Сьогодні'
*role:* student · *area:* i18n-a11y

- **Треба (ТЗ):** Use the existing today i18n key so en/sv students see 'Today'/'Idag'.
- **Зараз:** src/pages/student/StudentDashboardPage.tsx:260 renders `{isToday ? "Сьогодні" : d.toLocaleDateString(getLocale(), ...)}` — the today branch is a hardcoded Ukrainian literal while the else branch is locale-aware.
- **Доказ:** `src/pages/student/StudentDashboardPage.tsx:260`
- **Наслідок:** A student browsing in English/Swedish sees today's lessons tagged 'Сьогодні' while other days are localized — an inconsistent, untranslated label.
- **Фікс:** Replace with t('common.today') (or the appropriate existing today key) — the key already exists in all 3 locales.

#### ⚪ LOW — Widespread module-level bound t (i18nInstance.t.bind) won't re-render on language switch
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** Components subscribe to language changes (useTranslation) so text updates live when LanguageSwitcher calls i18n.changeLanguage.
- **Зараз:** ~40 components/pages define `const t = i18nInstance.t.bind(i18nInstance)` at module scope (e.g. GoogleCalendarCard.tsx:9, TelegramLinkCard.tsx:9, SubscriptionPage.tsx:29, RecordPaymentSheet.tsx:22). These read the current language at call time but are NOT subscribed to i18next's languageChanged event, so already-mounted screens keep stale-language strings until an unrelated re-render.
- **Доказ:** `src/components/GoogleCalendarCard.tsx:9; src/components/TelegramLinkCard.tsx:9; grep 'i18nInstance.t.bind' shows ~40 files`
- **Наслідок:** Switching language via LanguageSwitcher (uk<->en<->sv) leaves currently-mounted components showing the old language until they happen to re-render. Impact is limited because uk is primary and switching mid-session is rare, but it is a genuine latent i18n bug and a codebase-wide convention.
- **Фікс:** Prefer useTranslation() inside components for reactive t; where a module-level t is needed, force a re-render on i18n 'languageChanged'. Given it's pervasive, treat as a tracked cleanup rather than a single-line fix.


---

## ♿ Accessibility  (3)

#### 🟡 MED — Chat send buttons are icon-only with no aria-label / title
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** Icon-only buttons expose an accessible name for screen readers.
- **Зараз:** The primary chat send buttons render only a <Send> icon with no text, aria-label or title. src/pages/ChatsPage.tsx:1429-1438 (<button type="submit"> ... <Send/>), and src/components/ChatThreadDialog.tsx:308-315 (<Button onClick={send}> ... <Send/>).
- **Доказ:** `src/pages/ChatsPage.tsx:1429; src/components/ChatThreadDialog.tsx:308`
- **Наслідок:** Screen-reader users hear an unlabeled 'button' with no indication it sends the message; keyboard/AT users can't tell what the control does.
- **Фікс:** Add aria-label={t('chats.send')} (key already implied by other chat keys) to both send buttons.

#### 🟡 MED — 13px font-floor violation: .gamify-sticker uses text-xs (12px) in index.css and is rendered live in TutorWelcomeBanner — slips past check-ux
*role:* all · *area:* invariants

- **Треба (ТЗ):** 🔒 INVIOLABLE 13px minimum font floor: no readable text below 13px, in Tailwind classes OR inline. text-xs (12px) = VIOLATION; use text-[13px]+.
- **Зараз:** src/index.css:169 — `.gamify-sticker { @apply inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold; ... }`. This class is rendered as readable text in src/components/TutorWelcomeBanner.tsx:55 — `<span className="gamify-sticker">{t("tutorWelcome.level", { step, total: TOTAL_STEPS })}</span>` (a 'Рівень N з 9' badge on the tutor welcome banner). check-ux.mjs reports 0 errors because it scans component text-[Npx]/inline fontSize but does NOT scan `@apply text-xs` inside index.css utility classes — the documented gate blind spot for named classes routed through CSS.
- **Доказ:** `index.css:169 '... text-xs font-semibold;'; TutorWelcomeBanner.tsx:55 '<span className="gamify-sticker">'; 'node scripts/check-ux.mjs' → '0 помилок'; 'grep -rn text-xs src/' → only index.css:169.`
- **Наслідок:** A tutor-facing gamification badge renders at 12px, below the accessibility floor for the owner's low-vision / outdoor-sunlight users. Because the gate is green, this will keep passing unnoticed.
- **Фікс:** Change `text-xs` to `text-[13px]` in the `.gamify-sticker` @apply at index.css:169 (and check the other .gamify-* sticker variants below it). Optionally extend check-ux.mjs to scan @apply text-xs in index.css so this class of regression is caught.

#### ⚪ LOW — ChatThreadDialog close button aria-label is the glyph '✕' instead of a word
*role:* all · *area:* i18n-a11y

- **Треба (ТЗ):** aria-label is a human-readable localized word (e.g. 'Close').
- **Зараз:** src/components/ChatThreadDialog.tsx:225 `aria-label="✕"` — the accessible name is the multiplication-X glyph, which screen readers announce meaninglessly.
- **Доказ:** `src/components/ChatThreadDialog.tsx:225`
- **Наслідок:** Screen-reader users hear 'multiplication sign, button' (or nothing useful) for the dialog close control.
- **Фікс:** Use aria-label={t('common.close')} instead of the '✕' glyph.


---

## ✨ Delight opportunities  (1)

#### ⚪ LOW — RecordPaymentSheet mark-paid fires haptic only after the DB await (not instant)
*role:* independent-tutor · *area:* independent-tutor

- **Треба (ТЗ):** Per the 'mark paid must give INSTANT feedback' invariant: update UI optimistically, fire haptic.success() and toast immediately, THEN await the DB.
- **Зараз:** RecordPaymentSheet.tsx:118-123 handleMarkPaid sets `markingId` (row shows a spinner), `await onMarkLessonPaid(lessonId)`, and only then calls `haptic.success()`. The haptic is delayed by the full DB round-trip. The parent callback (FinancesPage.markLessonPaidById→togglePayment) is optimistic, so the row does leave the list, but the tap's haptic confirmation still waits on the network.
- **Доказ:** `RecordPaymentSheet.tsx:118-123 'setMarkingId(lessonId); await onMarkLessonPaid(lessonId); haptic.success(); setMarkingId(null);'.`
- **Наслідок:** On a slow connection the mark-paid tap feels laggy (spinner, delayed buzz), a minor divergence from the instant-feedback invariant enforced elsewhere.
- **Фікс:** Fire haptic.success() (and optionally clear markingId optimistically) before awaiting onMarkLessonPaid, reverting on error — mirror FinancesPage.togglePayment ordering.

> ⚠️ **Delight-можливості — НЕ верифіковані (впав ліміт сесії). Це напрямки, не баги.**

#### 🟠 HIGH — Hub tutor's core "win" (marking a lesson complete) is celebrated silently — no confetti/haptic/streak, unlike independent tutors
*role:* hub-tutor · *area:* delight

- **Треба (ТЗ):** Every tutor's most-frequent win — marking a conducted lesson complete — should land with the same reward the docs mandate: optimistic flip, haptic.success(), confetti, streak/first-lesson milestone, and awarding the student a reward emoji.
- **Зараз:** Hub tutors mark lessons complete almost exclusively via NeedsMarkingCard (DashboardPage.tsx:1820-1826, the pinned #1 hub-tutor job at the top of the hub block). NeedsMarkingCard.setStatus (NeedsMarkingCard.tsx:41-52) does `hapticSuccess()` then a bare `await supabase.from('lessons').update(...)` and only a plain toast — NO confetti, NO burstConfetti, NO day-closed check, NO student reward emoji, NO streak refresh. The rich celebration (burstConfetti, first-lesson milestone, gamification.refresh, student_rewards insert) lives ONLY in DashboardPage.updateStatus (lines 702-745), which fires when completing from a LessonCard in *today's* list. Hub tutors' primary completion surface is the NeedsMarkingCard, so they get the dull path.
- **Доказ:** `src/components/NeedsMarkingCard.tsx:44 'const { error } = await supabase.from("lessons").update({ status }).eq("id", id);' (await-first, no confetti) vs src/pages/DashboardPage.tsx:711-713 'burstConfetti({ count: 40, originY: 40 })' / 'burstConfetti()' + 731 'gamification.refresh()' + 736-744 student_rewards insert — o`
- **Наслідок:** The hub tutor's daily loop feels flat and un-rewarding compared to the independent tutor's; the streak they accrue never advances visibly (see separate finding), and their students silently lose reward emoji when completion happens through this path.
- **Фікс:** Have NeedsMarkingCard call back into the parent's updateStatus (pass `onComplete(id)` from DashboardPage) instead of writing the lesson row itself, so the single celebratory code path (optimistic → haptic → confetti → streak refresh → student reward → day-closed/first-lesson milestone) runs for ALL roles. At minimum, make setStatus optimistic-first and fire burstConfetti()+student reward insert on 'completed'.

#### 🟡 MED — Streak is computed for hub tutors but the StreakCard is never rendered for them — an invisible, wasted momentum mechanic
*role:* hub-tutor · *area:* delight

- **Треба (ТЗ):** If we compute a teaching streak for every tutor (useTutorGamification runs for `isTutor`), the motivational StreakCard (flame, freezes, 'X days to bonus') should be visible to hub tutors too — streaks are the highest-leverage retention hook and hub tutors teach daily.
- **Зараз:** useTutorGamification fetches the streak for all tutors (hook gated only on `isTutor`, DashboardPage.tsx:301-302), and the streak count is even referenced in the completion toast for any tutor (line 722-723). But StreakCard is rendered ONLY inside `{isIndependentTutor && (...)}` (DashboardPage.tsx:2520-2527, `<StreakCard streak={streak} />` at 2525). The hub-tutor block (lines ~1799-2050) renders the payout card, two stat tiles, and the «Pro активний · від хабу» chip — but no StreakCard. So a hub tutor accrues a streak they can never see.
- **Доказ:** `src/pages/DashboardPage.tsx:2520 '{isIndependentTutor && (' guards the only dashboard StreakCard at line 2525; hub-tutor block has no StreakCard render. AchievementsPage.tsx:53 shows it but that's a separate page, not the daily loop.`
- **Наслідок:** Hub tutors — the most active daily users — get zero streak feedback in their core loop; a built, working gamification mechanic is dark for a whole role, and the completion toast promises a streak the user has no card to see.
- **Фікс:** Render `<StreakCard streak={streak} />` inside the hub-tutor secondary stack too (mirror the independent-tutor block at 2520-2527), respecting the TutorNotesCard-position invariant by placing it after the hub stat tiles / with the streak+tasks group, not between the pinned bubbles and the notes card.

#### 🟡 MED — StudentPaymentsPage debt rows have no per-row action and payment details can't be copied — a dead-end for the student's one real money task
*role:* student · *area:* delight

- **Треба (ТЗ):** The one obvious next action on an unpaid row should be right there: a way to see/copy how to pay that tutor (card number / payment_details) inline, matching the copy-to-clipboard affordance the app already uses for phone/email on People. Paying is the student's core money loop.
- **Зараз:** Each unpaid lesson row (StudentPaymentsPage.tsx:253-269) shows subject, date, amount, and an 'awaiting' pill — but no action button and no link to the payment instructions. The «Як оплатити» card with `payment_details` (lines 226-245) is a separate block at the top, and the details are rendered as plain text (line 238-240) with NO copy button — unlike PeoplePage phone/email rows which have copy icons. The student must manually re-type a card number from a card that isn't adjacent to the debt they're trying to clear.
- **Доказ:** `src/pages/student/StudentPaymentsPage.tsx:238 '{t.payment_details}' rendered as bare <p> with no copy control; debt rows 256-268 contain only text + a status pill, no CTA. Contrast: PeoplePage/PersonEditSheet phone+email rows expose copy icons.`
- **Наслідок:** Adds friction to the exact action that makes tutors get paid; the student sees the amount owed but the path to pay is disjointed and un-tappable, hurting on-time payment (which also drives the tutor/manager's cash-flow delight).
- **Фікс:** Add a copy-to-clipboard button (with haptic.tap + a '📋 Скопійовано' toast) on each tutor's payment_details, and surface a small «Як оплатити» inline link/expander on each unpaid row that scrolls to / opens that tutor's details. Where LiqPayPayButton is applicable, offer 'Оплатити' inline.

#### ⚪ LOW — Leaving a review is the only student 'win' with no celebration — no confetti/haptic/reward for a rated lesson
*role:* student · *area:* delight

- **Треба (ТЗ):** Reviewing a lesson is a prosocial action we actively solicit; on submit it should feel rewarding (haptic.success + a tiny confetti/reward), consistent with homework-done (which fires burstConfetti+haptic) — and ideally grant a reward emoji to reinforce the collection loop.
- **Зараз:** ReviewPromptCard.submit (ReviewPromptCard.tsx:101-122) inserts the feedback and shows only `toast.success(t('reviewPrompt.thanks'))` — no haptic, no burstConfetti, no student_rewards insert. Compare StudentHomeworkPage.toggleDone (StudentHomeworkPage.tsx:52-56) which fires `haptic.success(); burstConfetti({ count: 14 }); toast.success(...)`.
- **Доказ:** `src/components/ReviewPromptCard.tsx:116 'toast.success(t("reviewPrompt.thanks") || "Дякуємо за відгук! 🌟")' with no haptic/confetti nearby; homework's celebratory pattern at StudentHomeworkPage.tsx:53-55 is the intended bar.`
- **Наслідок:** A soft, un-rewarded moment for behavior we want to encourage; misses an easy dopamine hit and a chance to feed the reward-collection loop that already exists (RewardCollection).
- **Фікс:** On successful review submit, add `haptic.success()` + `burstConfetti({ count: 14 })`, and optionally insert a bonus reward emoji into student_rewards so the RewardCollection grows for reviewing, not only for completed lessons.

#### ⚪ LOW — StudentSchedulePage empty tab uses a cold muted line instead of the mandated warm positive framing
*role:* student · *area:* delight

- **Треба (ТЗ):** Per the Empty States rule (ZERO 'Немає X', always warm/positive), an empty schedule tab should get the same iconful, encouraging treatment used on the homework page (📚 + a warm line) and the dashboard.
- **Зараз:** StudentSchedulePage renders empty tabs as a single small grey line: `<p className="py-8 text-center text-sm text-muted-foreground">{t('studentPagesExtra.noLessonsInTab')}</p>` (StudentSchedulePage.tsx:80). The value is «Поки тихо тут 📅» — friendlier than 'Немає', but it's a bare muted sentence with no icon/warmth card, inconsistent with the homework empty state (StudentHomeworkPage.tsx:256-261: dashed card + 38px 📚 + bold title + subtext).
- **Доказ:** `src/pages/student/StudentSchedulePage.tsx:80 vs src/pages/student/StudentHomeworkPage.tsx:256-261 (warm dashed-card empty state).`
- **Наслідок:** The schedule — a page a new student without a booking sees first — feels the emptiest and least warm; a cold blank tab undercuts the friendly tone the rest of the student surface sets.
- **Фікс:** Replace the bare <p> with the same warm dashed-card empty block used on the homework page (icon + bold reassuring title + subtext), reusing `studentPagesExtra.noLessonsInTab` as the subtitle. For the 'upcoming' tab specifically, add a 'Знайти репетитора' CTA when the student has no tutor.

#### ⚪ LOW — NeedsMarkingCard violates the optimistic-first invariant — marking shows a spinner during the DB round-trip instead of instant feedback
*role:* hub-tutor · *area:* delight

- **Треба (ТЗ):** Per the binding INSTANT-feedback invariant, any mark action must flip the UI optimistically + haptic + toast first, THEN await and revert on error — no dead wait.
- **Зараз:** NeedsMarkingCard.setStatus (NeedsMarkingCard.tsx:41-52) sets `busyId` (spinner on the button, line 97) and awaits the DB write BEFORE any visual change; the item only leaves the list after `onChanged()` reloads. This is the exact await-first pattern the docs call out as a regression (fixed in FinancesPage/DashboardPage but not here). This card is a primary surface for manager + hub + independent tutors (DashboardPage.tsx:1820, 2080).
- **Доказ:** `src/components/NeedsMarkingCard.tsx:42-51 'setBusyId(id); ... await supabase.from("lessons").update({ status })...; onChanged();' — no optimistic list update; spinner shown at line 97 during the round-trip.`
- **Наслідок:** On slow networks the tutor taps 'Проведено' and stares at a spinner for 1-2s with the card still present, unsure if it worked — the dead-hang UX the owner explicitly flagged as a repeated regression, on a card three roles use daily.
- **Фікс:** Make setStatus optimistic: remove the completed/cancelled item from the local `items` immediately (or lift state to the parent's updateStatus), fire haptic + toast now, then await and only re-insert/revert on error. Ideally consolidate with DashboardPage.updateStatus so the fix and the celebration land together.


---

## Розподіл по ролях (підтверджені)

| Роль | 🔴 | 🟠 | 🟡 | ⚪ | Разом |
|---|--:|--:|--:|--:|--:|
| manager | 1 | 1 | 6 | 10 | 18 |
| hub-tutor | 1 | 4 | 1 | 2 | 8 |
| independent-tutor | 0 | 2 | 11 | 7 | 20 |
| student | 0 | 0 | 3 | 3 | 6 |
| all | 0 | 0 | 7 | 5 | 12 |


---

## Додаток: відкинуті знахідки (15) — false positives, НЕ баги

- **[MEDIUM] Hub-tutor navigation label is «Фінанси» not «Виплати» — the payout-only key nav.payouts exists but is never wired** — Misread of the i18n namespace + fabricated dead-key claim. The finding asserts a key `nav.payouts = 'Виплати'` exists and is dead. It does not exist: line 698 of uk.ts (`payouts: "Виплати"`) is inside the `finances:` namespace (spans lines 610-812), NOT the `nav:` namespace (lines 112-148, which has no `payouts` key). The real key is `finances.payouts`, and it is actively used at src/pages/FinancesPage.tsx:2352 (`label={t("finances.payouts")}`), so it is not dead. The finding's own grep "returns zero usages" only because it greps for a key that never existed. The cited binding spec "HUB-TUTOR-HANDOFF" does not exist anywhere in the repo (docs/ has no such file and no doc references a payout nav label or «Виплати» as a nav string). Meanwhile the hub-tutor payout differentiation already exists on the page itself: FinancesPage.tsx:1574 renders `finances.pageSubtitleHubTutor` ("Your payouts from the school") and :1624 a hub-tutor `payoutHistoryTitle`. The AppSidebar.tsx:75 quote (`labelKey: "nav.finances"` for tutor) is accurate, but renaming a hub tutor's nav item is at most subjective label polish, not a defect, and rests on a nonexistent requirement + a nonexistent key.
- **[MEDIUM] Trial length stated as 30 days in Pro CTA + progress bar while spec/other copy say 21 days** — The finding conflates two intentionally-distinct trial lengths. The "21 days" in CLAUDE.md's Referral Flow and in the uk.ts referral strings (bonusDesc:1402, step2Desc:1443, rewardLineBold1:1447, rule1:1484) refers specifically to the trial granted to a REFERRED FRIEND arriving via a referral link ("він отримує 21 день тріалу замість 14"). The "30 days" in SubscriptionPage.trialTotal (line 292) and proCta ("30 днів безкоштовно"; uk.ts:374) refers to the GENERAL self-signup trial. That 30-day length is the DB-backed source of truth: migration 20260619071130 line 68 sets trial_until = now() + interval '30 days', and the signup trigger in 20260521180319 (lines 89, 110) also grants 30 days. CLAUDE.md's Monetization section further confirms 30 is intended ("reset every non-active tutor to a fresh 30-day trial"). There is NO baseline requiring the general signup trial to be 21 days — the only 21-day spec is the referral bonus, which the referral copy matches consistently. So trialTotal=30 (progress bar for the signup trial) and proCta="30 днів" are correct and DB-aligned, not a contradiction. The finding itself concedes "30 matches the DB." There is no false statement of the same trial's length in the same context; the numbers differ because the scenarios differ.
- **[LOW] StudentPaymentsPage shadows the module-level t with the tutor object inside the payment-details loop** — by design / misread
- **[LOW] Student dashboard greeting is generic «Привіт! 👋» — handoff specifies the personalized «Привіт, {імʼя}!»** — The cited "tutor greeting" contrast (uk.ts:2345 "Привіт, {{name}}!") is a misread — that key is in the `inviteLink` namespace, not a tutor dashboard greeting; the actual tutor dashboard uses time-of-day keys with a separately-loaded firstName. The finding's premise that the student's name is "already loaded/available" is false: StudentDashboardPage loads only tutor profiles, and useStudentContext exposes no name. The governing spec (STUDENT-CABINET-HANDOFF §3) is not present in the repo, so the expected-behavior claim is unverifiable. It is a cosmetic copy preference, not a bug or regression.
- **[HIGH] Form-redesign token migration still never applied — 337 raw #hex across the 9 brief screens (unchanged)** — The finding's entire "expected" requirement is sourced from a brief (form-redesign-audit-and-brief.md) that does NOT exist anywhere in the repo: `git ls-files '*.md'` lists no such file and `git grep -il 'form-redesign'` returns nothing. No tracked audit doc (UX-AUDIT.md, CROSS-ROLE-CONSISTENCY-AUDIT.md, APP-REVIEW-NOTES.md) mentions raw-hex removal or a token migration. So there was never an agreed/shipped requirement to swap these files off raw hex — the premise of a "never-applied migration" is invented. Furthermore, raw hex is the intended design idiom here: the binding DS handoff source (docs/design-system/pages_explore/student-form-final-standalone.html) ITSELF uses raw hex, and the 9 implemented screens share 16 of the exact same hex values with it (#2bbfaa, #0f0f1a, #f5f4f0, #6b7088, etc.), which in turn equal the token definitions in src/index.css (e.g. #2bbfaa = --primary: 171 63% 46%). Per user MEMORY, DS handoff HTML is the binding ТЗ and this app intentionally styles inline; these screens are faithful pixel-for-pixel reproductions of hex-based handoffs, not rot. The var(--sub,#6b7088) pattern is already CSS-variable-tokenized with a hex fallback.
- **[HIGH] Failing-WCAG muted color #9398b0 (2.85:1) still hardcoded in 6 of the 9 screens despite the index.css --sub=#6b7088 fix** — by design / misread
- **[HIGH] PeoplePage (brief's worst screen) still 119 raw hex — dominated by #6b7088 used inline instead of text-muted-foreground** — by design / misread
- **[MEDIUM] AvailabilityManager still uses old <Select> dropdown + native type="time" inputs instead of the variant-B chip/toggle redesign** — The finding's core claim — "None of the variant-B chip/toggle UI is present" — is refuted by the actual code. The variant-B redesign IS implemented and is the primary UI of AvailabilityManager.tsx: the main weekday list (lines 492-549) renders each day as a rounded day badge with its time slots as teal pill/CHIPS (line 503, borderRadius:999, inset teal ring, tabular-nums) plus a per-day animated SEGMENT TOGGLE switch (lines 542-548, role="switch" aria-checked, sliding knob, teal gradient on / gray off). Overrides render as designed pill cards (lines 578-603). The component even defines a full DS token palette `A` (line 85) matching the handoff's styles.css (teal #2BBFAA, gradTeal linear-gradient(135deg,#2BBFAA,#25a896), tealL, Inter/Plus Jakarta fonts, #F5F4F0 bg). The handoff shell that exists in ~/Downloads/availability-final.html is literally titled "Availability — фінал (варіант B)" for the main "Доступні години" screen — which has already been built to spec. The cited <Select> (623-637) and four type="time" inputs (643/651/722/730) live ONLY inside the two secondary add-slot MODALS (weekly-add + override-add) — transient input forms for picking a day and typing start/end times. They use the DS-approved, already-updated base Input/Select primitives (h-11 rounded-xl text-[15px], teal focus ring), are not sub-13px, and are not flagged by check-ux. The finding scanned only those dialog blocks and missed the redesigned main screen directly above them.
- **[MEDIUM] Chat panels use var(--sub,#6b7088) CSS-var-with-hardcoded-fallback plus raw #0f0f1a/#eceef3 instead of tokens** — The finding's literal citations are accurate (var(--sub,#6b7088) at the cited lines; the listed raw hex all present), but its core premise is wrong and contradicts the codebase's actual, documented design-token convention.

1) var(--sub,#6b7088) is NOT an anti-pattern here — it is the sanctioned app-wide convention used in 32 files across the entire component/page layer (grep-confirmed). --sub is now explicitly DEFINED in src/index.css:143 as #6b7088, and the fallback #6b7088 EXACTLY matches the defined variable. The index.css comment (lines 138-142) documents this as a deliberate WCAG-AA decision: "--sub is the name components actually reference... Defining it here fixes muted-text contrast app-wide... now resolve to #6b7088 (4.89:1 on white), which also matches the dominant hardcoded grey so the palette unifies." Swapping only these 2 files to text-muted-foreground would DIVERGE them from the rest of the app.

2) The finding's "expected" cites a CHATS-HANDOFF mandating text-muted-foreground/border-border/no-hex-fallbacks, but NO such handoff file exists in the repo, and NO design gate enforces a "no raw hex / use Tailwind tokens" rule (check-hardcode.mjs is a Cyrillic-string linter only; check-ux.mjs has no hex/token rule). The asserted spec is unverifiable and contradicts the actual DS values it targets: --ds-border:#eceef3, --ds-bg:#F5F4F0, --dark/--txt:#0f0f1a — the raw hex used here already matches these tokens.

3) The #0f0f1a usages (ChatContextPanel:193,206; ChatThreadDialog:220,265) are the DS primary-text color on white/light surfaces — correct DS values, and adjacent to the owner's DNF note that #0f0f1a is intentional.

4) The one arguable nit — #9398b0 at ChatThreadDialog:272 (timestamp on white bubble) — is the exact value index.css calls out as the OLD failing grey (2.85:1); the intentional owner fix is the --sub→#6b7088 migration, not a token swap. It's a single low-impact instance, not a medium design defect.

Overall this is a cosmetic quibble built on a false premise that the deliberate, documented app-wide var(--sub,fallback) convention is a bug.
- **[LOW] CTA dark-text requirement is ALREADY satisfied — do NOT 'fix' --primary-foreground back to white (flagged as NON-issue)** — The finding is self-declared as a NON-issue and the code confirms it. src/index.css line 23-24 sets `--primary: 171 63% 46%;` (teal) and `--primary-foreground: 240 27% 8%;` (dark), with an identical duplicate at lines 73-74 (.dark block). Dark text on teal CTAs is the intentional WCAG/contrast decision documented in both project memory and CLAUDE.md — explicitly on the DO-NOT-FLAG list. The CTA dark-text requirement is already satisfied; there is no current defect, only a warning against a hypothetical future revert. Per the verification rules, an already-satisfied / by-design item is isReal=false.
- **[LOW] WalletDialog 'Mark paid' tab ignores group-lesson participations for the pair** — By-design and consistent with the documented group-billing model. Group-lesson payments are intentionally marked per-participant in LessonDetailsDialog (GroupLessonParticipants) and settled in aggregate on FinancesPage (which flattens each participant to lesson_participants). WalletDialog's prepay-wallet mark tab reads lessons_visible by student_id, which by construction excludes group lessons (student_id = NULL); this omission matches the CLAUDE.md invariant "mark per-participant in the dialog" and is already documented inline. The finding invents an unstated "settle ALL lessons" requirement for WalletDialog that the code never claimed.
- **[LOW] Hub-tutor finances nav label is «Фінанси», not «Виплати» as the hub-tutor handoff specifies** — by design / misread
- **[MEDIUM] MarketingPage is 100% hardcoded Ukrainian despite binding the i18n t()** — MarketingPage being Ukrainian-only is an explicit, checked-in owner decision, not a bug. The project's own hardcode-enforcement gate scripts/check-hardcode.mjs line 23 lists "MarketingPage.tsx" in its SKIP_FILES exemption set, grouped with LandingPage.tsx, PrivacyPage.tsx, TermsPage.tsx and MarketingUnsubscribePage.tsx — files the script header documents as intentional i18n exceptions. So the codebase deliberately excludes this page from the "no hardcoded strings" i18n requirement. The finding's raw observations are all accurate (I confirmed grep -E '\bt\(' on MarketingPage.tsx returns zero matches, so the line-17 t binding is entirely unused, and every string on lines 27-31/95/103/106/113/119/132/139/143/154/159/169/187/194/215 is a hardcoded Ukrainian literal), and the route is manager-only (App.tsx line 101, allowedRoles=["manager"]). But because the project explicitly allowlisted this exact file, treating it as an i18n violation contradicts a deliberate owner decision — a false positive per the DO-NOT-FLAG guidance. The rationale is coherent: it is an internal manager-only email-blast composer targeting Ukrainian-speaking tutors, treated like the legal/landing pages. The only genuine (trivial) issue is the unused `t` import, which is a dead-code nit, not the described i18n-coverage defect.
- **[LOW] Per-route ErrorBoundary shows the raw React error.message to any user as the page fallback** — The code facts are accurate but the SECURITY characterization is wrong, so as a security finding this is a false positive. src/components/ErrorBoundary.tsx:35 does render `{this.state.error?.message ?? i18n.t("errorBoundary.unknownError")}` verbatim, and both boundaries omit a fallback prop (src/App.tsx:91 route-level `<ErrorBoundary key={location.pathname}>`; src/App.tsx:318 outer `<ErrorBoundary>`), so all roles hit the message branch. But there is no information disclosure: this is a client-side React SPA, and `error.message` is produced by JS running in the crashing user's OWN browser and shown back to that same user. Any URLs/ids/state it could contain are already fully present in that user's browser memory, network tab, JS bundle, and React DevTools — nothing is revealed that the user didn't already have. There is no cross-user/cross-tenant leak, no RLS bypass (RLS is the real server-side isolation boundary and a render-crash string cannot cross it), no privilege escalation, and no secret exposure. The boundary only catches React render/lifecycle throws (async Supabase query errors go through react-query/toasts, not here), and the actual thrown messages in the codebase are developer invariants (e.g. \"useAuth must be used within AuthProvider\", \"no canvas ctx\") or i18n-keyed user strings — none carry server secrets. Diagnostics are already preserved independently via console.error + logError to error_log (src/lib/errorLog.ts). What's left is a minor UX-polish nit (showing a cryptic English error to a user), not a security defect.
- **[HIGH] Global chat-toast realtime subscription has NO server-side filter — every chat_messages INSERT app-wide is streamed to every logged-in client, then re-fetched per event** — The finding's central premise — that with no client-side `filter:` "every chat_messages INSERT app-wide is streamed to every logged-in client" — misreads how Supabase realtime works. `postgres_changes` enforces the table's SELECT RLS policy per subscriber server-side, and `chat_messages` has an RLS SELECT policy scoped to thread participants + managers (migration 20260422065250 lines 64-81: "Participants view thread messages" USING tutor_id/student_id = auth.uid(); "Manager views all messages" via has_role). So a student/tutor only receives realtime events for their OWN threads; there is no app-wide fan-out. The finding even concedes "RLS on the realtime stream may drop some" but underweights that RLS drops ALL non-participant events, which collapses the "2 serial round-trips per message to potentially every online user" claim. The codebase documents this exact model: useUnreadChats.ts:23-25 uses the identical unfiltered chat_messages subscription noting "RLS already enforces ... only threads where they are tutor_id or student_id", and useAvailabilityRequestCount.ts:41-44 explicitly calls the client filter "defense-in-depth on top of table RLS, which already filters payloads."
