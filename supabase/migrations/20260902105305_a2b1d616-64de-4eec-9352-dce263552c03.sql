-- ============================================================================
-- Ідеї юзер-флоу 01.09 — №2 (видача ачівок) + №4/№5 (зламаний місячний підсумок)
--
-- ЗНАХІДКА ПІД ЧАС РОБОТИ: get_tutor_monthly_summary (жива версія 20260430074614)
-- читає lessons.student_payment_status, але 20260505162244 ПЕРЕНІС платіжні
-- колонки в lesson_details. Тобто RPC падає на КОЖНОМУ виклику з 05.05 —
-- MonthlySummaryCard тихо ховається у всіх користувачів чотири місяці.
-- Тут функція перевизначена на lesson_details (та сама сигнатура).
--
-- №2: у всьому репозиторії не було жодного INSERT INTO tutor_badges — сітка
-- /achievements, тости й нотифікації існували, але жоден бейдж не видавався.
-- award_my_badges() — ідемпотентний SECURITY DEFINER RPC, який клієнт кличе
-- при відкритті дашборда: умови — дзеркало badges.ts, вставка через
-- ON CONFLICT (tutor_id, badge_key) DO NOTHING (UNIQUE вже існує з 20260430).
-- Повертає СВІЖОвидані ключі, щоб клієнт оновив список і показав тости.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Полагоджений місячний підсумок: оплати — з lesson_details
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tutor_monthly_summary(_tutor_id uuid, _year int, _month int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _end timestamptz;
  _lessons_count int;
  _completed_count int;
  _priced_count int;
  _paid_count int;
  _on_time_pct numeric;
  _rank int;
  _total_active int;
  _percentile int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _start := make_timestamptz(_year, _month, 1, 0, 0, 0);
  _end := _start + interval '1 month';

  -- Оплати живуть у lesson_details (групові уроки рядка не мають — вони
  -- рахуються в уроках, але не входять у відсоток оплат).
  SELECT count(*) FILTER (WHERE l.status IN ('completed','scheduled')),
         count(*) FILTER (WHERE l.status = 'completed'),
         count(*) FILTER (WHERE l.status = 'completed' AND coalesce(ld.student_price, 0) > 0),
         count(*) FILTER (WHERE l.status = 'completed' AND coalesce(ld.student_price, 0) > 0
                            AND ld.student_payment_status = 'paid')
    INTO _lessons_count, _completed_count, _priced_count, _paid_count
  FROM public.lessons l
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
  WHERE l.tutor_id = _tutor_id
    AND l.starts_at >= _start AND l.starts_at < _end;

  IF _priced_count > 0 THEN
    _on_time_pct := round((_paid_count::numeric / _priced_count::numeric) * 100);
  ELSE
    _on_time_pct := NULL;
  END IF;

  -- Топ X% за проведеними уроками місяця (без змін — колонки живі)
  SELECT count(DISTINCT tutor_id) INTO _total_active
  FROM public.lessons
  WHERE starts_at >= _start AND starts_at < _end AND status = 'completed';

  IF _total_active > 0 AND _completed_count > 0 THEN
    SELECT count(*) + 1 INTO _rank
    FROM (
      SELECT tutor_id, count(*) AS c
      FROM public.lessons
      WHERE starts_at >= _start AND starts_at < _end AND status = 'completed'
      GROUP BY tutor_id
      HAVING count(*) > _completed_count
    ) sub;
    _percentile := GREATEST(1, ceil((_rank::numeric / _total_active::numeric) * 100)::int);
  ELSE
    _percentile := NULL;
  END IF;

  RETURN jsonb_build_object(
    'lessons_count', _lessons_count,
    'completed_count', _completed_count,
    'paid_count', _paid_count,
    'on_time_payment_pct', _on_time_pct,
    'top_percentile', _percentile,
    'total_active_tutors', _total_active,
    'year', _year,
    'month', _month
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Видача ачівок
-- ---------------------------------------------------------------------------
-- Внутрішній помічник: вставити один бейдж, повернути ключ, якщо він НОВИЙ.
CREATE OR REPLACE FUNCTION public.award_badge_once(_tutor uuid, _key text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ins int;
BEGIN
  INSERT INTO public.tutor_badges (tutor_id, badge_key)
  VALUES (_tutor, _key)
  ON CONFLICT (tutor_id, badge_key) DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  RETURN CASE WHEN _ins > 0 THEN ARRAY[_key] ELSE '{}'::text[] END;
END;
$$;
-- Помічник — лише для внутрішніх викликів (award_my_badges виконується від
-- імені власника, тож REVOKE його не зачіпає).
REVOKE EXECUTE ON FUNCTION public.award_badge_once(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.award_my_badges()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _new text[] := '{}';
  _completed int;
  _unpaid int;
  _streak int;
  _busy_month int;
  _my_month int;
  _active int;
  _rank int;
  _pct int;
  _start timestamptz;
  _end timestamptz;
BEGIN
  IF _me IS NULL OR NOT has_role(_me, 'tutor'::app_role) THEN
    RETURN _new;
  END IF;

  SELECT count(*) FILTER (WHERE l.status = 'completed'),
         count(*) FILTER (WHERE l.status = 'completed'
                            AND coalesce(ld.student_price, 0) > 0
                            AND coalesce(ld.student_payment_status, 'unpaid') <> 'paid')
    INTO _completed, _unpaid
  FROM public.lessons l
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
  WHERE l.tutor_id = _me;

  -- 🎯 Перший урок: провів перший урок в застосунку
  IF _completed >= 1 THEN
    _new := _new || public.award_badge_once(_me, 'first_lesson');
  END IF;

  -- 💸 Нуль боргів: є база (3+ проведених) і жоден проведений платний не висить
  IF _completed >= 3 AND _unpaid = 0 THEN
    _new := _new || public.award_badge_once(_me, 'no_debts');
  END IF;

  -- 🔥 Серія 7: уроки 7 днів підряд (рахує тригер update_tutor_streak)
  SELECT GREATEST(coalesce(current_streak, 0), coalesce(longest_streak, 0))
    INTO _streak
  FROM public.tutor_streaks WHERE tutor_id = _me;
  IF coalesce(_streak, 0) >= 7 THEN
    _new := _new || public.award_badge_once(_me, 'streak_7');
  END IF;

  -- 📅 Маніяк розкладу: 20+ уроків на календарний місяць
  SELECT max(c) INTO _busy_month FROM (
    SELECT count(*) AS c
    FROM public.lessons
    WHERE tutor_id = _me AND status IN ('scheduled','completed')
    GROUP BY date_trunc('month', starts_at)
  ) sub;
  IF coalesce(_busy_month, 0) >= 20 THEN
    _new := _new || public.award_badge_once(_me, 'schedule_maniac');
  END IF;

  -- 🤝 Перший реферал: привів першого друга
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referrer_id = _me) THEN
    _new := _new || public.award_badge_once(_me, 'first_referral');
  END IF;

  -- 👑 Топ-10% активності поточного місяця. Мінімум 5 активних репетиторів,
  -- інакше «топ» не має сенсу (на базі з двох людей топом був би кожен).
  _start := date_trunc('month', now());
  _end := _start + interval '1 month';
  SELECT count(*) INTO _my_month
  FROM public.lessons
  WHERE tutor_id = _me AND status = 'completed'
    AND starts_at >= _start AND starts_at < _end;
  IF _my_month > 0 THEN
    SELECT count(DISTINCT tutor_id) INTO _active
    FROM public.lessons
    WHERE status = 'completed' AND starts_at >= _start AND starts_at < _end;
    IF _active >= 5 THEN
      SELECT count(*) + 1 INTO _rank
      FROM (
        SELECT tutor_id
        FROM public.lessons
        WHERE status = 'completed' AND starts_at >= _start AND starts_at < _end
        GROUP BY tutor_id
        HAVING count(*) > _my_month
      ) sub;
      _pct := GREATEST(1, ceil((_rank::numeric / _active::numeric) * 100)::int);
      IF _pct <= 10 THEN
        _new := _new || public.award_badge_once(_me, 'top_tutor');
      END IF;
    END IF;
  END IF;

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_my_badges() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.award_my_badges() FROM PUBLIC, anon;