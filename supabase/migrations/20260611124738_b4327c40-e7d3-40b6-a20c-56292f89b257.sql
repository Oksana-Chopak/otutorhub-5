
CREATE OR REPLACE FUNCTION public.get_tutor_level(_tutor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _completed int;
  _referrals int;
  _is_pro boolean;
  _level_key text;
  _level_name text;
  _emoji text;
  _next_threshold int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO _completed FROM public.lessons WHERE tutor_id = _tutor_id AND status = 'completed';
  SELECT count(*) INTO _referrals FROM public.referrals WHERE referrer_id = _tutor_id AND pro_bonus_granted = true;
  SELECT is_tutor_pro(_tutor_id) INTO _is_pro;

  IF _completed >= 200 AND _is_pro THEN
    _level_key := 'pro_tutor'; _level_name := 'Про-репетитор'; _emoji := '👑'; _next_threshold := NULL;
  ELSIF _completed >= 100 AND _referrals >= 3 THEN
    _level_key := 'expert'; _level_name := 'Експерт'; _emoji := '🏆'; _next_threshold := 200;
  ELSIF _completed >= 50 THEN
    _level_key := 'master'; _level_name := 'Майстер'; _emoji := '⭐'; _next_threshold := 100;
  ELSIF _completed >= 10 THEN
    _level_key := 'practitioner'; _level_name := 'Практик'; _emoji := '📚'; _next_threshold := 50;
  ELSE
    _level_key := 'novice'; _level_name := 'Новачок'; _emoji := '🌱'; _next_threshold := 10;
  END IF;

  RETURN jsonb_build_object(
    'key', _level_key, 'name', _level_name, 'emoji', _emoji,
    'completed_lessons', _completed, 'referrals_count', _referrals,
    'is_pro', _is_pro, 'next_threshold', _next_threshold
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_tutor_level(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tutor_level(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_referral_leaderboard(_year integer, _month integer)
 RETURNS TABLE(referrer_id uuid, first_name text, last_name text, pro_upgrades integer, total_signups integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  RETURN QUERY
  WITH bounds AS (
    SELECT make_timestamptz(_year, _month, 1, 0, 0, 0) AS s,
           make_timestamptz(_year, _month, 1, 0, 0, 0) + interval '1 month' AS e
  )
  SELECT r.referrer_id, p.first_name, p.last_name,
         count(*) FILTER (WHERE r.upgraded_to_pro_at >= b.s AND r.upgraded_to_pro_at < b.e)::int,
         count(*) FILTER (WHERE r.signed_up_at    >= b.s AND r.signed_up_at    < b.e)::int
  FROM public.referrals r
  CROSS JOIN bounds b
  LEFT JOIN public.profiles p ON p.id = r.referrer_id
  GROUP BY r.referrer_id, p.first_name, p.last_name
  HAVING count(*) FILTER (WHERE r.signed_up_at >= b.s AND r.signed_up_at < b.e) > 0
  ORDER BY 4 DESC, 5 DESC
  LIMIT 50;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_referral_leaderboard(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard(integer, integer) TO authenticated;

DROP POLICY IF EXISTS "Manager views all reactions" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "Participants view reactions" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "Users add own reactions" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "Users remove own reactions" ON public.chat_message_reactions;

CREATE POLICY "Manager views all reactions"
ON public.chat_message_reactions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Participants view reactions"
ON public.chat_message_reactions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.chat_messages m
  JOIN public.chat_threads t ON t.id = m.thread_id
  WHERE m.id = chat_message_reactions.message_id
    AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
));

CREATE POLICY "Users add own reactions"
ON public.chat_message_reactions FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_threads t ON t.id = m.thread_id
    WHERE m.id = chat_message_reactions.message_id
      AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
  )
);

CREATE POLICY "Users remove own reactions"
ON public.chat_message_reactions FOR DELETE TO authenticated
USING (auth.uid() = user_id);
