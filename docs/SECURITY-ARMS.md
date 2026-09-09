# Арми ролі `manager` — модель «школа = сутність» (07.09.2026)

Джерело: аудит безпеки (серпень 2026) → рекон хвилі 45 → рішення власниці
31.08 («школа = окрема сутність») → хвиля 07.09 (три міграції + edge).

## Історія коротко

До 07.09 моделі належності до школи в схемі **не існувало**: менеджер
визначався як «єдиний акаунт із роллю manager» (`start_manager_chat`:
`ORDER BY user_id LIMIT 1`). Голий `has_role(manager)` писали не з
недбалості — **скоупити не було по чому**. Поки школа одна, «всі дані
платформи» = «дані моєї школи», витоку немає. З другою школою кожен такий арм
— витік: чужі уроки, ставки, гаманці, ростер.

Хвиля 45 (`20260831160000`) закрила приватне (токени карток, чати, реквізити)
і перевела платформенне на `is_superadmin()`. Операційні арми чекали на схему.

## Модель (етап A — `20260907100000_hub_entity_model.sql`)

| Обʼєкт | Що це | Хто пише |
|---|---|---|
| `hubs` | школа (id, name) | `create_hub` / `rename_hub` (RPC) |
| `hub_managers` | менеджери школи; **один менеджер = одна школа** (UNIQUE user_id) | `create_hub` |
| `tutor_workspace_settings.hub_id` | школа репетитора; NULL = незалежний; привілейована колонка (колонковий REVOKE + гард) | тригери `set_default_hub_id`, `ensure_hub_tutor_workspace`; `move_tutor_to_hub` (суперадмін) |
| `hub_members` | учні та pending-профілі школи (учень може бути в кількох школах) | тригери: pending-профіль від менеджера, роль від менеджера, `student_rates source='hub'` |

Предикати (усі `SECURITY DEFINER`, включають суперадміна):

- `is_hub_scoped(_tutor)` — репетитор у школі того, хто питає (або сам про себе).
  Скоуп для **уроків і грошей** — рахується від репетитора уроку, тому спільний
  учень двох шкіл видимий кожній лише в її частині.
- `is_hub_member(_user)` — людина в школі того, хто питає: репетитор, менеджер,
  учень/pending (`hub_members`), або учень із хабовою ставкою у репетитора школи.
  Скоуп для **профілів, контактів, ролей, нотаток**.
- `is_hub_manager_of(_tutor)` = `has_role(manager) AND is_hub_scoped(_tutor)` —
  для RPC.
- `is_manager_of_tutor(_manager, _tutor)`, `is_manager_of_user(_manager, _user)`
  — серверні двійники для edge-функцій під service role (EXECUTE лише
  `service_role`).
- `caller_hub_id()`, `hub_of_user(_user)`, `default_hub_id()` (лише поки школа
  одна — з другою повертає NULL, ніщо не «прилипає» до першої-ліпшої).

Що ще зроблено в етапі A: засів `platform_admins` по обох поштах власниці
(старий засів шукав не ту адресу — адмінка показувала замок); бекфіл єдиної
школи; **рядки `tutor_workspace_settings` для хабових репетиторів, створених у
«Людях»** (їх не було — `handle_new_user` пропускає рядок, коли роль уже є після
`merge_pending_profile`; тепер і `merge_pending_profile` переносить рядок та
членство з pending-профілю на реальний акаунт); роль `manager` видає лише
суперадмін (`guard_user_roles_writes`).

## Політики та в'ю (етап B — `20260907110000_hub_scope_policies.sql`)

78 живих manager-армів (інвентаризація скриптом: остання `CREATE POLICY` мінус
`DROP` по всій історії, тіла звірено слово в слово):

| Група | Скільки | Скоуп |
|---|---|---|
| механічний свіп (tutor_id / lesson_id / group / user_id) | 60 | `is_hub_scoped(...)` / `is_hub_member(...)` |
| файли уроків (storage), нотатки й журнал менеджера | 7 | `is_hub_scoped(репетитор уроку)` / `is_hub_member(subject_user_id \| actor_id)` |
| запити «знайти репетитора» | 3 | `is_superadmin() OR is_hub_member(student_id)` (запити без школи розводить власниця) |
| платформенне: бот, розсилки, реферали | 4 | `is_superadmin()` |
| realtime `subscription-requests:*` | 1 | школа репетитора з топіка |
| словник `subjects` | 1 → 3 | INSERT — менеджер будь-якої школи; UPDATE/DELETE — суперадмін |
| аватари | 1 | `is_hub_member(власник шляху)` (бакет публічний, політика лише для API) |

Два свідомі відхилення від механіки: `profiles` INSERT пускає `is_pending`
(свіжий pending-профіль ще не член — членство ставить AFTER-тригер етапу A;
інакше форма «Люди» не проходила б), `group_enrollments` скоупиться репетитором
групи, не учнем.

**Три DEFINER-в'ю** (`lessons_visible`, `lesson_participants_visible`,
`group_enrollments_visible`) — головний шлях читання грошей — мають ВЛАСНИЙ
manager-арм, якого не бачить жоден скан `pg_policies`. Перевипущено дослівно +
`is_hub_scoped(l.tutor_id)`.

## Функції (етап C — `20260907120000_hub_scope_rpcs.sql`)

RLS не захищає `SECURITY DEFINER`: 21 функцію перевипущено дослівно, змінено
рівно один вираз — роль → роль **і** школа: гроші уроку
(`update_lesson_details_safe`), виплати (`mark_tutor_payouts_paid`,
`set_lesson_tutor_payout_status[_bulk]`, `set_tutor_payout_schedule`,
`backfill_tutor_payouts_for_tutor`), гаманці (`get_wallet_balance`,
`wallet_topup/adjust/delete_transaction`), зведення (`manager_debts_summary`,
`manager_debts_by_currency`), профіль репетитора (`get_tutor_level`,
`get_tutor_monthly_summary`, `generate_referral_code`,
`get_referral_savings_uah`, `get_tutor_independent_student_count`), чати
(`get_or_create_chat_thread`), видалення (`manager_purge_user`,
`purge_user_data`), розсилки (`get_marketing_recipients` → суперадмін).
Мертві `get_lesson_financials`/`list_lesson_financials` (читали гроші з
`lessons`, де їх давно немає) — видалено.

Поза списком свідомо: тригери-гарди (`guard_*`, `protect_*`, `fill_*`)
не віддають даних; `get_people_aggregates` / `finances_period_totals` —
`SECURITY INVOKER`, самі скоупляться в'ю.

## Доповнення (`20260907125000_hub_scope_addendum.sql`) і перевірка живої бази (етап D — `20260907130000_hub_scope_assert.sql`)

Етап D — чиста перевірка: сканує `pg_policies`, `pg_proc` (SECURITY DEFINER,
не тригери) і `pg_views` (DEFINER-в'ю) на справжній `has_role(…, 'manager')`
без жодного хабового предиката поруч і падає переліком. Прогнана на репліці
після A–C, вона знайшла те, що свіп по файлу проминув, — закрито доповненням:

- `feedback_submissions` — дві політики з іменами БЕЗ лапок (свіп шукав лише
  `"…"`): звернення в застосунку — платформенне → суперадмін.
- `set_group_enrollment_price` / `set_group_participant_payment` — ціна
  групового запису й оплата учасників → школа репетитора групи.
- `is_group_tutor` / `is_group_active_student` — гілка «менеджер питає про
  будь-кого» → лише про репетитора/учня своєї школи (політики кличуть їх з
  `auth.uid()`, тож на них це не впливає).
- `create_notification` — менеджер сповіщає лише свою школу
  (`is_hub_member`); менеджера сповіщає лише його школа (`hub_managers` ×
  `hub_of_user` / `hub_members`), суперадміна (`platform_admins`) — будь-хто:
  так `notify_managers` незалежного репетитора доходить до платформи.
  Дозвіл більше не спирається на `has_role(<інший користувач>)`: до
  перф-міграції 20260602 та версія повертала false для всіх, крім `auth.uid()`.

Порядок застосування: A → B → C → доповнення → D (має надрукувати
`✅ Хаб-скоуп: чисто`; провал = список для агента) → імпорт `20260907150000`.

## Edge-функції під service role

`remind-payment`, `notify-lesson-update`, `sync-google-calendar` →
`is_manager_of_tutor`; `send-student-invite` → `is_manager_of_user`;
`send-marketing-campaign` → `platform_admins`; дайджести
(`tutor-daily-digest`, `tutor-weekly-digest`), `payout-reminders`,
`telegram-poll hpaid` → фільтр уроків школою менеджера (`hub_managers` ×
`settings.hub_id`; до застосування етапу A таблиці немає — поведінка стара).
Попутно: `manager_debts_summary` під service role завжди повертала нулі
(`auth.uid()` порожній) — тотали дайджесту тепер рахуються в самій функції.

## Як тримається

- `src/test/hub-scope-sweep.test.ts` — кожен арм етапу B скоуплений, в'ю без
  голого арму, кожна функція етапу C перевіряє школу, edge-функції кличуть
  серверні предикати.
- `src/test/manager-policy-ratchet.test.ts` — новий голий `has_role(manager)`
  у `CREATE POLICY` = червоний CI (скоупом вважається `is_hub_*`,
  `is_superadmin`, `caller_hub_id`).
- Прогін 07.09 на локальному Postgres 16 (стаб auth/storage/realtime, повна
  історія міграцій → три нові файли): дві школи, менеджер Б бачить лише свої
  уроки/борги/профілі, не може позначити виплати школи А, не може видати роль
  manager; «Люди» (pending → контакти → роль) дає репетитора одразу в школі;
  реєстрація запрошеного переносить школу; незалежний не бачить шкіл.
- Доповнення прогнано там само під обома версіями `has_role` (20260422 і
  20260602): менеджер Б не ставить ціну/«оплачено» групам школи А, не сповіщає
  її людей; учень/репетитор школи Б доходить лише до свого менеджера, будь-хто —
  до суперадміна; етап D після доповнення друкує `✅`, а на навмисно доданих
  голій політиці / функції / в'ю — падає з їхніми іменами.

## Що далі (не блокує)

- UI: переносити репетитора між школами (`move_tutor_to_hub` є, кнопки немає).
- Запрошення в школу посиланням (без ручного створення pending-профілю).
- Кілька менеджерів на школу — модель уже дозволяє (`hub_managers`), RPC
  «додати менеджера» ще немає.
