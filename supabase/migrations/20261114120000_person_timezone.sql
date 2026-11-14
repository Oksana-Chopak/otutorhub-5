/* ============================================================================
   Часовий пояс людини (14.11, рішення власниці: «так, звісно виправ і те, що знайшла»).

   Власниця — у Стокгольмі, репетиторка — у Києві, учень — у Берліні. Урок зберігається як
   момент часу, і застосунок показує його кожному за поясом ЙОГО пристрою. Але:
     • усі серверні повідомлення (нагадування про урок і оплату, дайджести, штраф за
       скасування) писали час за Києвом і не казали цього — учень у Берліні читав київський
       час як свій;
     • форма уроку не могла сказати «у репетиторки це буде 16:00»;
     • вільні години репетитора (записані його місцевим часом) показувались людині в
       іншому поясі без перерахунку.
   Причина одна: пояс людини ніде не зберігався.

   Тепер: `profiles.timezone` — пояс пристрою в записі IANA («Europe/Kyiv»). Його пише сам
   застосунок при вході (`set_my_timezone`), людина нічого не вводить. Читають його ті, хто й
   так бачить профіль людини (`people_timezones` — SECURITY INVOKER, тобто під RLS таблиці
   profiles), і серверні функції (service_role).

   Перевірка значення — за формою запису, а не за списком поясів Postgres: рахує час не база,
   а застосунок і функції (Intl), а список у базі може бути старішим за браузер
   («Europe/Kyiv» зʼявився у 2022-му — стара база відмовила б кожному українцеві).

   Ідемпотентно. -- LIVE-MARKER: people_timezones
   ============================================================================ */

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.profiles.timezone IS
  'Пояс пристрою людини в записі IANA; пише застосунок при вході (set_my_timezone). NULL — людина ще не заходила.';

CREATE OR REPLACE FUNCTION public.set_my_timezone(_tz text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF _tz IS NULL OR length(_tz) > 64 OR _tz !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$' THEN
    RAISE EXCEPTION 'BAD_TIMEZONE' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.profiles SET timezone = _tz
   WHERE id = auth.uid() AND timezone IS DISTINCT FROM _tz;
END $$;

REVOKE ALL ON FUNCTION public.set_my_timezone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_timezone(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.people_timezones(_ids uuid[])
RETURNS TABLE (user_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.id, p.timezone
    FROM public.profiles p
   WHERE p.id = ANY (_ids[1:500]) AND p.timezone IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.people_timezones(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_timezones(uuid[]) TO authenticated, service_role;
