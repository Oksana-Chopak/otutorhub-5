-- Private per-lesson tutor notes ("🔒 Нотатки — бачиш лише ти" in the lesson editor).
-- Separate table on purpose: lesson_details is SELECT-able by the student (homework,
-- summary), so a notes column there would leak. This table is tutor-only — no student
-- or manager policy.
create table if not exists public.lesson_tutor_notes (
  lesson_id uuid primary key,
  tutor_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lesson_tutor_notes enable row level security;

create policy "Tutor manages own lesson notes"
  on public.lesson_tutor_notes
  for all to authenticated
  using (auth.uid() = tutor_id)
  with check (auth.uid() = tutor_id);

create trigger trg_lesson_tutor_notes_updated
  before update on public.lesson_tutor_notes
  for each row execute function public.update_updated_at_column();
