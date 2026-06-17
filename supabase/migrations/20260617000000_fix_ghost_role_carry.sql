-- ============================================================
-- FIX: hub tutor (and any invited user) registers but ends up "Без ролі".
--
-- Root cause: the manager-created ghost's role lives only in user_roles, and the
-- ONLY thing that carries it to the real auth user is merge_pending_profile(),
-- called from handle_new_user() inside a swallow-all `EXCEPTION WHEN OTHERS`
-- block (a PL/pgSQL SAVEPOINT). The live merge inserts the real user's
-- profile_contacts row while the ghost still holds the SAME lower(email),
-- colliding on the partial unique index profile_contacts_email_lower_uniq.
-- The merge throws → the whole savepoint rolls back → role NOT transferred and
-- ghost NOT deleted → user has zero user_roles ("Без ролі") + ghost persists
-- ("Очікує реєстрації"). Only a RAISE WARNING is logged.
--
-- Fix: (1) make merge_pending_profile collision-proof — clear ANY contact row
-- holding this email/phone (not just the ghost's) before inserting; (2) backfill
-- already-broken accounts (confirmed users with no role + a matching ghost).
-- Must be APPLIED to the live DB (Supabase), not just committed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ghost_id uuid;
  _ghost_email text;
  _ghost_phone text;
BEGIN
  SELECT p.id, c.email, c.phone
    INTO _ghost_id, _ghost_email, _ghost_phone
  FROM public.profiles p
  JOIN public.profile_contacts c ON c.user_id = p.id
  WHERE p.is_pending = true
    AND (
      (_email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email))
      OR (_phone IS NOT NULL AND _phone <> '' AND c.phone = _phone)
    )
  LIMIT 1;

  IF _ghost_id IS NULL OR _ghost_id = _real_id THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  UPDATE public.lessons SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.lessons SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.lessons SET created_by = _real_id WHERE created_by = _ghost_id;
  UPDATE public.student_rates SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.student_rates SET student_id = _real_id WHERE student_id = _ghost_id;

  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;

  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;

  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;

  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;

  -- COLLISION-PROOF: remove ANY contact row (ghost or stale) that holds this
  -- email/phone before inserting the real user's, so the lower(email) partial
  -- unique index can never abort the merge. (Was: only the ghost's row.)
  DELETE FROM public.profile_contacts
    WHERE user_id <> _real_id
      AND (
        (_email IS NOT NULL AND _email <> '' AND lower(email) = lower(_email))
        OR (_phone IS NOT NULL AND _phone <> '' AND phone = _phone)
        OR user_id = _ghost_id
      );

  INSERT INTO public.profile_contacts (user_id, email, phone)
  VALUES (_real_id, COALESCE(NULLIF(_email, ''), _ghost_email), COALESCE(NULLIF(_phone, ''), _ghost_phone))
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);

  DELETE FROM public.profiles WHERE id = _ghost_id;

  PERFORM set_config('app.pending_profile_merge', '', true);

  RETURN _ghost_id;
END;
$function$;

-- ── Backfill: repair users already left role-less by a previously-failing merge.
-- For every confirmed auth user with NO user_roles row, re-run the (now fixed)
-- merge using their auth email/phone; it no-ops unless a matching pending ghost
-- exists, in which case it transfers the role and removes the ghost.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT u.id AS uid, COALESCE(u.email, '') AS email, COALESCE(u.phone, '') AS phone
    FROM auth.users u
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE ur.user_id IS NULL
      AND u.email_confirmed_at IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.merge_pending_profile(r.uid, r.email, r.phone);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill merge_pending_profile failed for %: %', r.uid, SQLERRM;
    END;
  END LOOP;
END;
$$;
