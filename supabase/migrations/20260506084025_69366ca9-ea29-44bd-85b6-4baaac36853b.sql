CREATE TEMP TABLE lesson_duplicate_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    l.id,
    first_value(l.id) OVER (
      PARTITION BY
        l.tutor_id,
        CASE WHEN l.group_id IS NULL THEN 'student' ELSE 'group' END,
        COALESCE(l.group_id, l.student_id),
        l.starts_at,
        l.duration_minutes,
        lower(btrim(l.subject)),
        l.source
      ORDER BY
        (ld.student_payment_status = 'paid') DESC,
        (ld.tutor_payout_status = 'paid') DESC,
        l.updated_at DESC NULLS LAST,
        l.created_at DESC NULLS LAST,
        l.id DESC
    ) AS keep_id,
    row_number() OVER (
      PARTITION BY
        l.tutor_id,
        CASE WHEN l.group_id IS NULL THEN 'student' ELSE 'group' END,
        COALESCE(l.group_id, l.student_id),
        l.starts_at,
        l.duration_minutes,
        lower(btrim(l.subject)),
        l.source
      ORDER BY
        (ld.student_payment_status = 'paid') DESC,
        (ld.tutor_payout_status = 'paid') DESC,
        l.updated_at DESC NULLS LAST,
        l.created_at DESC NULLS LAST,
        l.id DESC
    ) AS rn
  FROM public.lessons l
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
)
SELECT id AS duplicate_id, keep_id
FROM ranked
WHERE rn > 1;

WITH related AS (
  SELECT keep_id, keep_id AS lesson_id FROM lesson_duplicate_map
  UNION
  SELECT keep_id, duplicate_id AS lesson_id FROM lesson_duplicate_map
),
lesson_agg AS (
  SELECT
    r.keep_id,
    (array_agg(l.status ORDER BY
      CASE l.status
        WHEN 'completed' THEN 4
        WHEN 'scheduled' THEN 3
        WHEN 'pending' THEN 2
        WHEN 'cancelled' THEN 1
        ELSE 0
      END DESC,
      l.updated_at DESC NULLS LAST,
      l.created_at DESC NULLS LAST
    ))[1] AS status,
    (array_agg(l.notes ORDER BY ((l.notes IS NOT NULL) AND (btrim(l.notes) <> '')) DESC, l.updated_at DESC NULLS LAST))[1] AS notes,
    (array_agg(l.meeting_url ORDER BY ((l.meeting_url IS NOT NULL) AND (btrim(l.meeting_url) <> '')) DESC, l.updated_at DESC NULLS LAST))[1] AS meeting_url,
    max(l.updated_at) AS updated_at
  FROM related r
  JOIN public.lessons l ON l.id = r.lesson_id
  GROUP BY r.keep_id
)
UPDATE public.lessons l
SET
  status = lesson_agg.status,
  notes = COALESCE(lesson_agg.notes, l.notes),
  meeting_url = COALESCE(lesson_agg.meeting_url, l.meeting_url),
  updated_at = GREATEST(l.updated_at, lesson_agg.updated_at)
FROM lesson_agg
WHERE l.id = lesson_agg.keep_id;

WITH related AS (
  SELECT keep_id, keep_id AS lesson_id FROM lesson_duplicate_map
  UNION
  SELECT keep_id, duplicate_id AS lesson_id FROM lesson_duplicate_map
),
details_agg AS (
  SELECT
    r.keep_id,
    (array_agg(ld.homework ORDER BY ((ld.homework IS NOT NULL) AND (btrim(ld.homework) <> '')) DESC, ld.updated_at DESC NULLS LAST))[1] AS homework,
    (array_agg(ld.summary ORDER BY ((ld.summary IS NOT NULL) AND (btrim(ld.summary) <> '')) DESC, ld.updated_at DESC NULLS LAST))[1] AS summary,
    (array_agg(ld.student_notes ORDER BY ((ld.student_notes IS NOT NULL) AND (btrim(ld.student_notes) <> '')) DESC, ld.updated_at DESC NULLS LAST))[1] AS student_notes,
    max(ld.student_price) FILTER (WHERE ld.student_price IS NOT NULL) AS student_price,
    max(ld.tutor_payout) FILTER (WHERE ld.tutor_payout IS NOT NULL) AS tutor_payout,
    CASE
      WHEN bool_or(ld.student_payment_status = 'paid') THEN 'paid'
      WHEN bool_or(ld.student_payment_status = 'unpaid') THEN 'unpaid'
      ELSE NULL
    END AS student_payment_status,
    CASE
      WHEN bool_or(ld.tutor_payout_status = 'paid') THEN 'paid'
      WHEN bool_or(ld.tutor_payout_status = 'unpaid') THEN 'unpaid'
      ELSE NULL
    END AS tutor_payout_status,
    max(ld.student_paid_at) AS student_paid_at,
    max(ld.tutor_paid_at) AS tutor_paid_at,
    max(ld.updated_at) AS updated_at
  FROM related r
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = r.lesson_id
  GROUP BY r.keep_id
)
INSERT INTO public.lesson_details (
  lesson_id,
  homework,
  summary,
  student_notes,
  student_price,
  tutor_payout,
  student_payment_status,
  tutor_payout_status,
  student_paid_at,
  tutor_paid_at,
  updated_at
)
SELECT
  keep_id,
  homework,
  summary,
  student_notes,
  student_price,
  tutor_payout,
  student_payment_status,
  tutor_payout_status,
  student_paid_at,
  tutor_paid_at,
  COALESCE(updated_at, now())
FROM details_agg
ON CONFLICT (lesson_id) DO UPDATE SET
  homework = COALESCE(EXCLUDED.homework, public.lesson_details.homework),
  summary = COALESCE(EXCLUDED.summary, public.lesson_details.summary),
  student_notes = COALESCE(EXCLUDED.student_notes, public.lesson_details.student_notes),
  student_price = COALESCE(EXCLUDED.student_price, public.lesson_details.student_price),
  tutor_payout = COALESCE(EXCLUDED.tutor_payout, public.lesson_details.tutor_payout),
  student_payment_status = COALESCE(EXCLUDED.student_payment_status, public.lesson_details.student_payment_status),
  tutor_payout_status = COALESCE(EXCLUDED.tutor_payout_status, public.lesson_details.tutor_payout_status),
  student_paid_at = COALESCE(EXCLUDED.student_paid_at, public.lesson_details.student_paid_at),
  tutor_paid_at = COALESCE(EXCLUDED.tutor_paid_at, public.lesson_details.tutor_paid_at),
  updated_at = GREATEST(public.lesson_details.updated_at, EXCLUDED.updated_at);

UPDATE public.lesson_attachments a
SET lesson_id = m.keep_id
FROM lesson_duplicate_map m
WHERE a.lesson_id = m.duplicate_id;

UPDATE public.lesson_change_requests r
SET lesson_id = m.keep_id
FROM lesson_duplicate_map m
WHERE r.lesson_id = m.duplicate_id;

UPDATE public.lesson_feedback f
SET lesson_id = m.keep_id
FROM lesson_duplicate_map m
WHERE f.lesson_id = m.duplicate_id;

UPDATE public.lesson_payment_reminders r
SET lesson_id = m.keep_id
FROM lesson_duplicate_map m
WHERE r.lesson_id = m.duplicate_id;

UPDATE public.lesson_reminders r
SET lesson_id = m.keep_id
FROM lesson_duplicate_map m
WHERE r.lesson_id = m.duplicate_id;

DELETE FROM public.lessons l
USING lesson_duplicate_map m
WHERE l.id = m.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_unique_visible_slot_idx
ON public.lessons (
  tutor_id,
  (CASE WHEN group_id IS NULL THEN 'student' ELSE 'group' END),
  (COALESCE(group_id, student_id)),
  starts_at,
  duration_minutes,
  (lower(btrim(subject))),
  source
);