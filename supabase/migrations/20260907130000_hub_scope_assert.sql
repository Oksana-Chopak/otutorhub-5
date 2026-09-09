-- ═══════════════════════════════════════════════════════════════════════════
-- ХАБ — етап D: ПЕРЕВІРКА живої бази (аудит 07.09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Етапи A–C переписують 78 політик і доводяться тестом hub-scope-sweep. Але
-- тест читає ФАЙЛ міграції, а не базу. Якщо в проді існує manager-політика,
-- якої в тому файлі немає (створена Lovable, додана після генерації свіпу) —
-- вона лишиться без скоупу, і НІЩО про це не скаже. Саме так у ux-step49
-- свіп мовчки проминув три реальні назви політик.
--
-- Цей файл нічого не змінює. Він дивиться в pg_policies, pg_proc і pg_views
-- і падає з переліком, якщо знайде незакритий арм. Запускати ПІСЛЯ 1-2-3-4
-- (доповнення 20260907125000 закриває те, що ця ж перевірка знайшла на
-- репліці); можна перезапускати скільки завгодно — це чиста перевірка.
--
-- Що вважається «manager-армом» у функції: справжня перевірка ролі
-- has_role(<хто>, 'manager'), а не будь-яка згадка слова (назва таблиці
-- manager_notes чи коментар — не арм). Тригерні функції не перевіряються:
-- вони не викликаються користувачем і не мають «дозволу», який можна обійти.
-- Прийнятий скоуп поруч: is_hub_scoped / is_hub_member / is_hub_manager_of /
-- caller_hub_id / hub_of_user / is_superadmin / hub_managers /
-- is_manager_of_tutor / is_manager_of_user.
--
-- Чому це важливо для бізнесу: поки школа одна, незакритий арм невидимий.
-- З приходом ДРУГОЇ школи кожен такий арм — це чужі уроки, ставки й гаманці
-- у неї на екрані. Дешевше побачити список зараз, ніж на клієнті.
--
-- LIVE-MARKER-NONE: перевірка нічого не створює. Успіх = «Хаб-скоуп: чисто».
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  _bad text;
  _n   int;
  _scope_re constant text :=
    '(is_hub_scoped|is_hub_member|is_hub_manager_of|caller_hub_id|hub_of_user|is_superadmin|hub_managers|is_manager_of_tutor|is_manager_of_user)';
  -- справжня перевірка ролі менеджера: has_role(<перший аргумент>, 'manager'…)
  _mgr_re constant text := 'has_role\s*\([^,]*,\s*''manager''';
BEGIN
  -- 1) Політики: manager-арм без жодного хабового предиката поруч.
  SELECT string_agg(format('  • %s.%s :: %s', schemaname, tablename, policyname), E'\n' ORDER BY tablename, policyname),
         count(*)
    INTO _bad, _n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* _mgr_re
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~* _scope_re;

  IF _n > 0 THEN
    RAISE EXCEPTION E'⛔ Незакриті manager-політики (%): доступ до даних ЧУЖОЇ школи.\n%\n\nЦе не помилка застосування — етапи A–C уже в базі. Надішли цей список агентові: кожну політику треба перевипустити зі скоупом.', _n, _bad;
  END IF;

  -- 2) SECURITY DEFINER-функції (не тригери), що перевіряють роль manager,
  --    але не звіряють школу.
  SELECT string_agg(format('  • %s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), E'\n' ORDER BY p.proname),
         count(*)
    INTO _bad, _n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.prosecdef                                   -- лише SECURITY DEFINER
    AND p.prorettype <> 'trigger'::regtype            -- тригери не викликаються користувачем
    AND pg_get_functiondef(p.oid) ~* _mgr_re
    AND pg_get_functiondef(p.oid) !~* _scope_re
    AND p.proname NOT IN (
      'has_role',
      -- перевіряє роль ЦІЛЬОВОЇ пошти («це не учень»), а не дозвіл того, хто кличе
      'add_or_link_independent_student'
    );

  IF _n > 0 THEN
    RAISE EXCEPTION E'⛔ SECURITY DEFINER-функції з manager-армом без перевірки школи (%):\n%\n\nНадішли цей список агентові.', _n, _bad;
  END IF;

  -- 3) DEFINER-в'ю (без security_invoker) з manager-армом без школи:
  --    в'ю читається під власником, тож RLS таблиць її не рятує.
  SELECT string_agg(format('  • %s.%s', v.schemaname, v.viewname), E'\n' ORDER BY v.viewname),
         count(*)
    INTO _bad, _n
  FROM pg_views v
  JOIN pg_class c ON c.relname = v.viewname AND c.relnamespace = 'public'::regnamespace
  WHERE v.schemaname = 'public'
    AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
        NOT IN ('true', 'on')
    AND v.definition ~* _mgr_re
    AND v.definition !~* _scope_re;

  IF _n > 0 THEN
    RAISE EXCEPTION E'⛔ DEFINER-в''ю з manager-армом без перевірки школи (%):\n%\n\nНадішли цей список агентові.', _n, _bad;
  END IF;

  RAISE NOTICE '✅ Хаб-скоуп: чисто — жодного manager-арму без перевірки школи.';
END$$;
