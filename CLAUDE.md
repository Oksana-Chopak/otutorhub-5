# oTutorHub — Project Context for AI Agents

## What is this?
A tutoring management platform for independent tutors, tutoring hubs, and students.
Built with: React + TypeScript + Tailwind + shadcn/ui + Supabase + i18next.
169 components, 32 pages, 3 roles: tutor / manager / student.
Languages: Ukrainian (primary), English, Swedish.

## Owner
Oksana Chopak — she is the PM/CEO. All agents work for her.
She communicates in Ukrainian. Always respond in Ukrainian unless asked otherwise.

## Tech stack
- Frontend: React 18 + TypeScript + Vite
- UI: shadcn/ui + Tailwind CSS
- Backend: Supabase (PostgreSQL + RLS + Edge Functions)
- i18n: react-i18next (uk/en/sv locales in src/i18n/locales/)
- Hosting: Lovable (auto-deploys from GitHub main branch)
- Repo: https://github.com/Oksana-Chopak/otutorhub-5

## Critical rules — NEVER break these

### Code quality
- TypeScript: ZERO errors (`npx tsc --noEmit` must pass)
- Tests: ALL 118 tests must pass (`npm run test`)
- i18n: NO hardcoded Ukrainian strings outside dayAffirmations
- Mobile: inputs must be h-11 mobile / md:h-10 desktop (no h-9 overrides)
- Text: minimum text-sm for readable content (no text-[11px])

### Before ANY commit, run:
```bash
npx tsc --noEmit          # Must exit 0
npm run test              # Must show 118 passed
node scripts/check-i18n.mjs      # Must exit 0
node scripts/check-hardcode.mjs  # Must exit 0
node scripts/check-ux.mjs        # Must exit 0
```

### Git workflow
- Main branch: `main` — deploys automatically to otutorhub.com via Lovable
- Feature branches: `claude/feature-name` or `fix/issue-name`
- Always pull before starting: `git pull origin main`
- Always push after completing: `git push origin main`

## Data model (key tables)
- `profiles` — all users (tutors, students, managers)
- `lessons` — all lessons, `source` column: 'hub' | 'independent' | null
- `lesson_details` — homework, notes, AI summary, payment details
- `workspace_settings` — per-tutor settings, isPro, trial, onboarding_step
- `student_rates` — tutor↔student price pairs
- `chat_threads` + `chat_messages` — messaging
- `student_rewards` — gamification rewards for students

## Data isolation rules (CRITICAL)
- Independent tutor lessons (source='independent') are PRIVATE
- Managers CANNOT see independent tutor data
- RLS policies enforce this at DB level
- Frontend also filters: `.neq("source", "independent")` for manager queries

## Roles
- `manager` — hub admin, sees hub lessons/students/finances
- `tutor` — teaches lessons, can be hub tutor OR independent
- `student` — takes lessons, has simplified dashboard

## Key files
```
src/
  pages/          — 32 page components
  components/     — 169 shared components
  hooks/          — custom React hooks
  lib/            — utilities (currency, subjects, badges)
  i18n/locales/   — uk.ts / en.ts / sv.ts (2100+ keys each)
  test/           — Vitest unit tests
  
scripts/
  check-i18n.mjs      — validates translation keys
  check-hardcode.mjs  — finds untranslated Ukrainian
  check-ux.mjs        — checks mobile touch targets

supabase/
  migrations/     — DB schema changes (applied by Lovable)
  functions/      — Edge Functions (email, Telegram, etc.)

.github/workflows/
  ci.yml          — 4 CI jobs (build, tests, i18n, ux)
```

## Known issues (backlog)
1. ChatContextPanel — not showing for manager role (selectedId logic issue)
2. Prepayments deduction — needs verification after lesson marked complete
3. Student flow — not fully audited yet
4. E2E tests — not yet implemented (Playwright config exists, no test files)
5. Admin analytics — no platform-wide stats for Oksana yet

## Design system
See: /mnt/user-data/outputs/otutorhub_design_system_prompt.md
- Primary color: teal (#0CA678)
- Font: Plus Jakarta Sans Variable
- Border radius: rounded-2xl for cards
- Mobile-first: 44px minimum tap targets

## i18n keys structure
All keys are namespaced: `section.keyName`
Examples: `nav.schedule`, `auth.login`, `lessonCard.statusCompleted`
Plural forms: `_one`, `_few`, `_many` (UK) / `_one`, `_other` (EN/SV)

## Lovable integration note
Lovable auto-deploys `main` branch. After pushing:
- Wait ~2 min for build
- Check build status at lovable.dev
- New DB migrations in supabase/migrations/ are auto-applied
