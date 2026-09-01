# Build-error fix roadmap

- [ ] Fix frontend TypeScript errors
  - [ ] Duplicate `subjectsSaveFailed` keys in `src/i18n/locales/en.ts`, `uk.ts`, `sv.ts`
  - [ ] `OfflineQueueItem` shape mismatch in `lessonActions.ts`, `lessonDetailsSafe.ts`, `ChatsPage.tsx`
  - [ ] `selectedThread` used before declaration in `ChatsPage.tsx`
- [ ] Fix Supabase edge-function TypeScript errors
  - [ ] `admin-stats/index.ts` possible-null array iterations
  - [ ] `process-email-queue/index.ts` RPC/SupabaseClient type mismatches
  - [ ] `scheduled-notifications/index.ts` `.catch()` on RPC builder
  - [ ] `send-push/index.ts` `Uint8Array<ArrayBufferLike>` vs `BufferSource`
  - [ ] `sync-google-calendar/index.ts` missing `location` property
  - [ ] `telegram-poll/index.ts` missing `escapeHtml` function
  - [ ] `tutor-daily-digest/index.ts` array element property access
- [ ] Run `npx tsc --noEmit` and edge-function type checks to verify all green
