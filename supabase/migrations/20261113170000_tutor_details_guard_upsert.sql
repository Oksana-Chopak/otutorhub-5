/* ============================================================================
   Репетитор школи знову може зберегти свої предмети
   (13.11, робот «кожна кнопка»: профіль → «Предмети» → «Зберегти» → помилка).

   Захист ставки від 11.11 (`guard_tutor_details_rates`) на ВСТАВЦІ від імені репетитора
   школи ставив `rate_per_lesson := NULL`, а колонка — NOT NULL (типово 0). Застосунок
   зберігає предмети через «вставити або оновити», і база спершу пробує вставку — тож
   будь-яке збереження предметів репетитором школи (профіль, онбординг) падало з
   «null value in column rate_per_lesson», навіть коли рядок уже існував.

   Тепер на вставці ставка = 0 («не задано» — її поставить менеджер), групова — NULL.
   Заборона змінювати ставку самому лишається, як була.

   Ідемпотентно. -- LIVE-MARKER-NONE: перевипуск тіла наявної функції (types.ts його не бачить)
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.guard_tutor_details_rates()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _school boolean;
BEGIN
  IF auth.uid() IS NULL OR public.is_superadmin() THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT COALESCE((SELECT s.hub_id IS NOT NULL OR COALESCE(s.independent_workspace, false) = false
                     FROM public.tutor_workspace_settings s WHERE s.tutor_id = NEW.user_id), true)
    INTO _school;
  IF NOT _school THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.rate_per_lesson := 0;            -- «не задано»: ставку поставить менеджер (колонка NOT NULL)
    NEW.group_rate_per_lesson := NULL;
    RETURN NEW;
  END IF;
  IF NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.group_rate_per_lesson IS DISTINCT FROM OLD.group_rate_per_lesson THEN
    RAISE EXCEPTION 'Ставку виплати репетитору школи змінює лише менеджер школи'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
