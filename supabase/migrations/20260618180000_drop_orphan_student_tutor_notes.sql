/* ============================================================================
   Fix: "Students can overwrite tutor-authored notes on their own profile".

   public.student_details.tutor_notes was an early per-student tutor-note column.
   It was SUPERSEDED by the dedicated public.tutor_student_notes table
   (one row per (tutor_id, student_id), written by MyStudentsPage / QuickAddStudentDialog;
   see the "no per-student tutor_notes column" note in QuickAddStudentDialog). Nothing in
   the app (frontend, edge functions, RPCs) reads or writes student_details.tutor_notes
   anymore — it is orphaned.

   But student_details still has the "Student updates own details" UPDATE policy
   (USING auth.uid() = user_id), which is row-level and therefore covers EVERY column —
   so a student could overwrite this tutor-authored value. Since the column is dead,
   the correct fix is to drop it: the attack surface disappears and there is nothing to
   migrate (no code path consumes it). Real tutor notes are unaffected — they live in
   tutor_student_notes (tutor/manager write, students have no policy there).

   Idempotent (DROP COLUMN IF EXISTS).
   ============================================================================ */
ALTER TABLE public.student_details DROP COLUMN IF EXISTS tutor_notes;
