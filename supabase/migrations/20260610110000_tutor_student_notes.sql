-- Private tutor notes about a student ("Нотатки — бачиш лише ти" in the student form).
-- Deliberately a separate table: student_rates and tutor_student_defaults are readable
-- by the student (price / meeting url), so notes there would leak. This table has
-- tutor-only RLS — no student or manager policy at all.
create table if not exists public.tutor_student_notes (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null,
  student_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tutor_id, student_id)
);

alter table public.tutor_student_notes enable row level security;

create policy "Tutor manages own student notes"
  on public.tutor_student_notes
  for all to authenticated
  using (auth.uid() = tutor_id)
  with check (auth.uid() = tutor_id);

create trigger trg_tutor_student_notes_updated
  before update on public.tutor_student_notes
  for each row execute function public.update_updated_at_column();
