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
-- Цей файл нічого не змінює. Він дивиться в pg_policies і pg_proc і падає з
-- переліком, якщо знайде незакритий арм. Запускати ПІСЛЯ 1-2-3; можна
-- перезапускати скільки завгодно — це чиста перевірка.
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
BEGIN
  -- 1) Політики: manager-арм без жодного хабового предиката поруч.
  SELECT string_agg(format('  • %s.%s :: %s', schemaname, tablename, policyname), E'\n' ORDER BY tablename, policyname),
         count(*)
    INTO _bad, _n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%manager%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%is_hub_scoped%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%is_hub_member%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%caller_hub_id%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%is_superadmin%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%hub_managers%';

  IF _n > 0 THEN
    RAISE EXCEPTION E'⛔ Незакриті manager-політики (%): доступ до даних ЧУЖОЇ школи.\n%\n\nЦе не помилка застосування — етапи A–C уже в базі. Надішли цей список агентові: кожну політику треба перевипустити зі скоупом.', _n, _bad;
  END IF;

  -- 2) SECURITY DEFINER-функції, що згадують manager, але не звіряють школу.
  SELECT string_agg(format('  • %s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), E'\n' ORDER BY p.proname),
         count(*)
    INTO _bad, _n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef                                   -- лише SECURITY DEFINER
    AND pg_get_functiondef(p.oid) ILIKE '%manager%'
    AND pg_get_functiondef(p.oid) NOT ILIKE '%is_hub_scoped%'
    AND pg_get_functiondef(p.oid) NOT ILIKE '%is_hub_member%'
    AND pg_get_functiondef(p.oid) NOT ILIKE '%caller_hub_id%'
    AND pg_get_functiondef(p.oid) NOT ILIKE '%is_superadmin%'
    AND pg_get_functiondef(p.oid) NOT ILIKE '%hub_managers%'
    AND p.proname NOT IN ('has_role', 'is_manager_of_tutor', 'is_manager_of_user', 'notify_managers');

  IF _n > 0 THEN
    RAISE EXCEPTION E'⛔ SECURITY DEFINER-функції з manager-армом без перевірки школи (%):\n%\n\nНадішли цей список агентові.', _n, _bad;
  END IF;

  RAISE NOTICE '✅ Хаб-скоуп: чисто — жодного manager-арму без перевірки школи.';
END$$;
