-- ============================================================
-- Per-student private tutor note ("🔒 Нотатки — бачиш лише ти" in the
-- SF_A add-student form / QuickAddStudentDialog).
--
-- Home: student_details (one row per student, already upserted on create).
-- This is the per-student detail record; adding the note here keeps it
-- 1:1 with the student and avoids a second round-trip table.
--
-- Idempotent: safe to re-run (IF NOT EXISTS). No data change to existing rows.
-- ============================================================

alter table public.student_details
  add column if not exists tutor_notes text;
