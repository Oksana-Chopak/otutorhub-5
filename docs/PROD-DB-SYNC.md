# PROD-DB-SYNC — що з міграцій живе в проді

Єдине місце, де будь-який агент (виконавець, аудиторка, Lovable) дивиться стан
бази **без питань до власниці**. Перевіряється скриптом:

```
node scripts/check-db-sync.mjs
```

## Як воно працює під капотом

1. Файл у `supabase/migrations/` — лише текст. У прод він потрапляє **тільки**
   коли власниця вставить його в чат Lovable («виконай у базі точно як є»).
2. Після застосування Lovable записує **свій хеш-файл** `YYYYMMDDHHMMSS_<uuid>.sql`
   (це водяний знак) і перегенеровує `src/integrations/supabase/types.ts`
   із **живої** бази.
3. Тому `types.ts` — єдине об'єктивне дзеркало проду. Міграція з таймстемпом
   **нижче** останнього хеш-файлу буде **мовчки пропущена** (ordering trap).

## Правила для агентів

- Новий таймстемп завжди **вище** останнього хеш-файлу Lovable (`check-db-sync`
  показує його першим рядком). Інакше — перейменувати (`git mv`), не чекати.
- Кожна міграція, що додає колонку/функцію, несе рядок
  `-- LIVE-MARKER: <фрагмент, який має з'явитись у types.ts>`. Скрипт звіряє
  його з `types.ts` і каже `✅ live` / `⛔ NOT live` — це і є відповідь «чи вже».
- **Межа методу (аудит 03.09).** `types.ts` описує ФОРМУ схеми, не її тіло.
  Міграція, що перевипускає наявне в'ю чи функцію з тією самою сигнатурою,
  збігається з маркером ЩЕ ДО застосування — скрипт скаже «✅ live» про те,
  чого в проді немає. Такі міграції несуть `-- LIVE-MARKER-NONE: <як перевірити
  вручну>`, скрипт друкує «❓ не доводиться», а стан береться з цього журналу.
- Ідемпотентність обов'язкова (`IF EXISTS` / `OR REPLACE` / `ON CONFLICT`):
  власниця не може перевірити, що вже запускала, — SQL сам мусить бути байдужим.
- SQL для власниці — **у чат, цілком**, не «скопіюй з репо».
- Після Run: коли Lovable оновить `types.ts`, агент запускає `check-db-sync`,
  бачить `✅ live` і переводить рядок нижче у ✅. Лише тоді — «done».

## Журнал

| Міграція | Що | Як перевірити (types.ts) | Стан |
|---|---|---|---|
| `< 20260903081642` (107 файлів) | історія до 03.09 — застосована через пайплайн Lovable у свій час | схема в `types.ts` | ✅ історія |
| `20260903081642_a4976b0d…` | M1: `source` immutable + гейт цін групових (аудит 02.09) | хеш-файл Lovable | ✅ |
| `20260903100000_lessons_visible_currency` | M4: `currency` у `lessons_visible` (валюта пари) | `lessons_visible` Row має `currency` | ✅ 03.09 (Lovable `150928`) |
| `20260903110000_money_by_currency` | M3: `manager_debts_by_currency()`, `get_people_aggregates` + `unpaid_by_currency` | `manager_debts_by_currency`, `unpaid_by_currency` у types | ✅ 03.09 (Lovable `151318`) |
| `20260903150000_finances_period_totals` | M2 (справжній): підсумки /finances рахує база через `lessons_visible` (INVOKER) | `finances_period_totals` у types | ✅ 03.09 (Lovable `151432`) |
| `20260903210000_fix_visible_dup_and_totals_grant` | ⛔ Аудит 03.09: `lessons_visible` дублювала уроки пари з кількома предметами (дохід і борг подвоєні); `finances_period_totals` падала з 42501 у кожного (читала базову `lesson_participants`); лог нагадувань не приймав жодного рядка (CHECK + UNIQUE) | **не доводиться з types.ts** (перевипуск в'ю і функції). Вручну: `SELECT count(*) FROM lessons_visible WHERE id='<урок пари з 2 предметами>'` = 1; виклик `finances_period_totals` від звичайного репетитора не 42501 | ✅ 03.09 (Lovable `210021`) |
| `20260903170000` / `20260903180000` (драфти «хаб = акаунт менеджера») | ЗНЯТО 07.09: суперечили рішенню власниці 31.08 «школа = окрема сутність»; замінено трьома міграціями нижче | — | ✂️ видалено з репо |
| `20260904100000_debt_conducted_only_and_topup_date` | Борг = проведений і не оплачений (обидві хабові функції) · `wallet_topup` приймає дату внесення | `wallet_topup` Args мають `_paid_at` | ✅ 05.09 (Lovable `044807`) |
| `20260905120000_chat_thread_manager_scope` | П1.3: менеджер поза тредом не відкриває пари САМОСТІЙНОГО репетитора (support-треди з менеджером-стороною — як раніше) | **не доводиться з types.ts** (перевипуск функції). Вручну: менеджер → `get_or_create_chat_thread(<незалежний>, <його учень>)` = помилка 'Not allowed'; хабова пара = id треду | ✅ live (Lovable-хеш `20260905095032` містить обидві функції слово в слово) |
| `20260905130000_people_aggregates_debt_model` | Аудит 05.09: «Люди» рахували борг за СКАСОВАНОЮ моделлю (будь-який неоплачений, майбутні включно; штраф губився). Предикат = проведене + штраф — як financials.ts / manager_debts_* | **не доводиться з types.ts** (перевипуск функції). Вручну: учениця з (700 проведений, 350 штраф, 1050 майбутній) у «Людях» = Борг 1 050 (2), не 2 100 (3) | ✅ live (Lovable-хеш `20260905095032` містить обидві функції слово в слово) |
| `20260905200000_db_backup_bucket_and_cron` | Бекапи (премортем п.8): приватний бакет db-backups (без жодної політики — лише service role) + pg_cron 23:45 UTC → edge db-backup (gzip-знімок 24 бізнес-таблиць, ретенція 30 днів) | **не доводиться з types.ts** (бакет і cron.job поза types). Вручну: зранку в Storage → db-backups має бути backup-YYYY-MM-DD.json.gz | ⛔ чекає Run у Lovable + деплой db-backup |
| `20260907100000_hub_entity_model` | ХАБ етап A: `hubs`, `hub_managers`, `hub_members`, `settings.hub_id` (привілейована) + предикати `is_hub_scoped`/`is_hub_member`/`is_manager_of_*` + бекфіл єдиної школи + рядки settings для хабових репетиторів без них + `merge_pending_profile` переносить школу + роль manager лише від суперадміна + `create_hub`/`rename_hub`/`move_tutor_to_hub` + `start_manager_chat`/`notify_managers` через школу + засів `platform_admins` по обох поштах | `hubs`, `hub_managers`, `hub_members` Row у types; `tutor_workspace_settings` Row має `hub_id`; `create_hub` у types | ✅ 09.09 (Lovable `20260909083313`; копія = наш файл + guard `EXISTS profiles` у двох бекфілах — один осиротілий рядок `user_roles` (tutor без профілю) пропущено, інакше FK падав — + явні GRANT на три таблиці) |
| `20260907110000_hub_scope_policies` | ХАБ етап B: 78 manager-політик + 3 DEFINER-в'ю (`lessons_visible`, `lesson_participants_visible`, `group_enrollments_visible`) скоуплено на школу; платформенне → суперадмін | **не доводиться з types.ts**. Вручну: `SELECT count(*) FROM pg_policies WHERE qual ILIKE '%is_hub_%' OR with_check ILIKE '%is_hub_%'` ≥ 70 | ⛔ чекає Run у Lovable (2 з 6, після ✅ етапу A) |
| `20260907120000_hub_scope_rpcs` | ХАБ етап C: 21 SECURITY DEFINER-функція перевіряє школу (`is_hub_manager_of`); мертві `get_lesson_financials`/`list_lesson_financials` видалено | `get_lesson_financials` ЗНИКАЄ з types; `is_hub_manager_of` зʼявляється | ⛔ чекає Run у Lovable (3 з 6, ПІСЛЯ 2) + редеплой edge: remind-payment, notify-lesson-update, sync-google-calendar, send-student-invite, send-marketing-campaign, tutor-daily-digest, tutor-weekly-digest, payout-reminders, telegram-poll |
| `20260907125000_hub_scope_addendum` | ХАБ доповнення (07.09, знайдено етапом D на репліці): `feedback_submissions` — 2 політики без лапок (звернення = платформенне → суперадмін); `set_group_enrollment_price` / `set_group_participant_payment` — школа репетитора групи; `is_group_tutor` / `is_group_active_student` — менеджер питає лише про свою школу; `create_notification` — менеджер сповіщає лише свою школу, менеджера — лише його школа (суперадміна — будь-хто) | **не доводиться з types.ts** (нових об'єктів немає) — доводиться етапом D: `✅ Хаб-скоуп: чисто` | ⛔ чекає Run у Lovable (4 з 6, ПІСЛЯ 3) |
| `20260907130000_hub_scope_assert` | ХАБ етап D (аудит 07.09): ЧИСТА перевірка живої бази — сканує `pg_policies`, `pg_proc` і `pg_views` на manager-арми без хабового предиката і падає списком. Свіп A–C доводиться по ФАЙЛУ, тож політика, якої у файлі немає, лишилась би без скоупу мовчки (так ux-step49 проминув три назви). Уточнено 07.09: арм = справжня `has_role(…, 'manager')`, не будь-яка згадка слова; тригери не перевіряються; `is_hub_manager_of` / `hub_of_user` / `is_manager_of_*` — прийнятий скоуп; + DEFINER-в'ю | **не доводиться з types.ts** (нічого не створює). Успіх = `NOTICE ✅ Хаб-скоуп: чисто`; провал = перелік політик/функцій/в'ю | ⛔ чекає Run у Lovable (5 з 6, ПІСЛЯ 4) |
| `20260907150000_carried_over_import` | Імпорт «усе, що є» (07.09): `lessons.carried_over` (перенесений борг = cancelled + штраф + carried_over — у грошах є, у «проведено»/серіях/бейджах нема), `lessons_visible` + `lesson_details_student` віддають колонку, RPC `import_student_bundle` (учень + борг + передоплата + розклад на 4 тижні, серверний замок `is_tutor_pro`), `award_my_badges` рахує штрафи як борг, `add_or_link_independent_student` приймає учня без прізвища (NOT NULL падав) | `lessons` Row має `carried_over`; `import_student_bundle` у types | ⛔ чекає Run у Lovable (6 з 6, ОСТАННЯ, після ✅ етапу D) + редеплой edge payment-reminders, tutor-weekly-digest |
