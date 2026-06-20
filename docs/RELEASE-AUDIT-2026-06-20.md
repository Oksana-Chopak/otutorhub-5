# oTutorHub — Release-Readiness Audit (2026-06-20)

**Branch:** `fix/release-blockers` · **Method:** 4 parallel audit streams (security · design/a11y · architecture/perf · native/release) + manual verification of every high-severity claim.

## Bottom line

The code is in genuinely strong shape. All four quality gates are green: **TypeScript 0 errors · 133 tests pass · i18n synced (3318 keys × uk/en/sv) · UX audit 0 errors / 8 warnings**, and the production build succeeds. This is a polish-and-harden job, not a rescue.

The gap to "downloadable in the stores" is mostly **release engineering + owner-gated console work**, plus a short list of real correctness/security fixes. The single most important *app* bug is `window.confirm()`/`alert()` silently failing in the iOS WebView (12 sites) — destructive actions run with no confirmation on iOS. The single biggest *release* blocker is that the iOS native project doesn't exist yet (`npx cap add ios`, Mac-only).

Severity: **P0** blocks submission / data-loss · **P1** likely rejection or real bug · **P2** should-fix before launch · **P3** nice-to-have.

---

## 1. Security

Recent security work is visible and good: the June-18 multi-tenant isolation fix (hub managers can't read independent tutors' data) is enforced at the RLS layer; LiqPay signatures are verified server-side; the RevenueCat webhook is authorized; no service-role/LiqPay private keys ship to the client; subscription/financial self-promotion is blocked by triggers; payment redirect URLs are allow-listed.

Open items:

- **P1 — `lesson_details` financial columns have no write-side RLS protection.** A tutor's `FOR UPDATE` policy on `lesson_details` is column-unrestricted, so the Supabase API would accept a direct update to `tutor_payout` / `student_price` on their own lessons. The `lessons` table is protected by the `protect_lesson_financials` trigger + a RESTRICTIVE policy; `lesson_details` never got the equivalent. *Fix:* mirror that trigger on `lesson_details` (migration to draft; owner-applied via Supabase).
- **P1 — Real credentials sit in `.env.e2e`.** The file is gitignored (✓ confirmed line 26 — not in the public repo), but it holds real account emails + a shared password in plaintext on disk, readable by any local tooling. *Fix:* rotate that password now; replace with disposable test-only accounts (`.env.e2e.example` already shows the shape). *(Password not reproduced here by design.)*
- **P2 — `confirm-pending-signup` rate limit is in-memory only.** Per-isolate `Map` resets when Deno recycles isolates, leaving a thin email-enumeration vector against pending ghost accounts. *Fix:* durable table-based rate limit keyed on email+IP, or gateway rate limiting.
- **P2 — `profiles` is readable by every authenticated user (`USING (true)`).** Cross-hub profile enumeration (names, avatars). Low-sensitivity but a data-minimization gap. *Fix:* scope reads to own-profile + related users + same-org managers (evaluate perf).
- **P2 — Wildcard CORS on money endpoints.** `liqpay-create-payment` / `liqpay-cancel` use `Access-Control-Allow-Origin: *`; tighten to the existing origin allow-list. Webhooks don't need CORS at all.
- **P2 — `google-calendar-callback` falls back to the service-role key as the OAuth state secret** when `OAUTH_STATE_SECRET` is unset. *Fix:* set `OAUTH_STATE_SECRET` and drop the fallback.
- **P3 — Cron shared secret is in plaintext in migration `20260512234710`.** Rotate via the Vault UI (not a new committed migration). Also: `revenuecat-webhook` should use constant-time secret compare (like `fireflies-webhook`); `send-transactional-email` should be `verify_jwt = false` so user JWTs never reach the function body.
- **Verified RESOLVED:** the `referral_codes` "Anyone can resolve code" anon policy flagged by the scan was **dropped** in migration `20260511212813`. Confirm its replacement is a narrow RPC, then close.

Residual risk: **low-to-medium**, concentrated in the `lesson_details` write protection and the `.env.e2e` rotation.

---

## 2. Design consistency & accessibility

The design system is ~85% consistently applied. The biggest wins were structural — fixing the shadcn base components once makes dozens of call-sites compliant (done this session, §6).

- **P1 — Base components didn't match the design tokens** (`card.tsx` `rounded-lg`; `button.tsx` `rounded-md`; `select.tsx`/`textarea.tsx` `rounded-md`). *(Fixed this session — see §6.)*
- **P1 — Touch targets below 44px on real controls.** PeoplePage person-sheet action icons (`h-8`/`h-9`), the expand chevron (`h-8`), ChatsPage mobile back/reaction buttons (32–36px), FinancesPage filter selects (`h-9`) are primary interactions, not the allowed compact-footer exceptions. *Fix:* raise to `h-10`/`h-11`.
- **P1 — Off-palette greys.** `#6b7088`, `#6b7a99`, `#8a96b3` instead of `var(--sub)` (esp. DashboardPage); `hover:bg-gray-100` and hardcoded `#22c55e`/`#ef4444` bypass success/destructive tokens. *Fix:* route through tokens.
- **P1 — A few empty states break the "no «Немає»" rule and skip i18n:** `SubscriptionRequestsPage`, `IncomeByStudentPie`, `ProfitSparkline`. *Fix:* positive framing + i18n keys.
- **P1 — Accessibility:** icon-only buttons using `title` instead of `aria-label` (PeoplePage); FinancesPage period segmented control lacks `role`/`aria-checked`; `--sub #9398b0` on white is ~3.1:1 (fails AA 4.5:1); ChatsPage online-green `#22c55e` on white ~2.4:1. *Fix:* aria-labels/roles; darken `--sub` and the success shade.
- **P2 — Secondary/admin pages still use full-page `Loader2` spinners** (Achievements, FeedbackInbox, PaywallMetrics, SubscriptionRequests) instead of skeletons.
- **Verified FALSE POSITIVE:** the `PageHeader` "burger → /profile" issue is real in the file but `PageHeader` is **imported nowhere** — dead code. The live mobile header (`AppLayout`) correctly dispatches `toggleSidebar`. Recommendation: delete `PageHeader.tsx`. (Its 22px h1 being "the standard" was the basis for an h1-size finding; the de-facto live standard is `AppLayout`'s compact `text-[17px]`.)

---

## 3. Architecture & performance

Production-viable. Routes are lazy-loaded, the dependency list is disciplined (date-fns; no moment/lodash/three), the QueryClient is well-configured, and there's a working ErrorBoundary + OfflineBanner. Two debts will bite at scale.

- **P1 — 619 kB Radix/shadcn catch-all chunk on the critical path.** *(Fixed this session — split into `radix-ui` (115 kB) + `ui-misc` (65 kB); catch-all 619 → 446 kB; >500 kB warning gone. See §6.)*
- **P1 — `DashboardPage` is a 2,380-line god component:** 30+ `useState`, one monolithic `loadData()` firing 7+ queries every mount, no React Query caching, minimal memoization. *Fix (staged):* role-specific data hooks; migrate to `useQuery`.
- **P1 — PeoplePage over-fetch:** `.limit(2000)` lessons + chunked `lesson_details` fan-out + unbounded `profiles` fetch on every mount → 8–10 round-trips for a large hub. *Fix:* push debt/last-interaction into a Postgres view/RPC; paginate.
- **P2 — React Query used for 2 of ~327 Supabase calls** → cache config applies to almost nothing; every navigation cold-reloads.
- **P2 — `select('*')` on 18+ tables; `as any` ×218 / `: any` ×142** (notably `const db: any = supabase` in `useNotifications`, rendered globally). tsc passes *because* `as any` suppresses errors — add missing tables (e.g. `notifications`) to generated types and remove casts.
- **P2 — Single root ErrorBoundary** — one route crash takes down the whole shell. *Fix:* per-route boundaries.
- **P2 — Finances/Dashboard load unbounded/`limit(500)` lesson sets client-side** for aggregation; silently-truncated finance data for big hubs is a correctness risk. Move aggregations server-side.
- **P3:** retire `OnboardingContent`/`OnboardingDialog` (dead, ~12 kB); strip `console.*` + wire an error reporter; lazy-load locales; consolidate `src/test` + `src/tests`.
- **Verified:** `html2canvas` (201 kB) is **already** a deferred async chunk; Recharts (349 kB) is correctly route-split. Not critical-path costs.

---

## 4. Native & release readiness

Android scaffolding exists and is policy-correct (in-app account deletion implemented, LiqPay hidden on native, appId `ua.otutorhub.app`, SDK 36, icons generated). Edge-function `config.toml` coverage is **complete** (no orphaned/missing functions). But neither platform can produce a shippable build today.

- **P0 — iOS project missing.** `npx cap add ios` never ran (Mac + Xcode only). Hard prerequisite for TestFlight, IAP sandbox testing, App Store submission.
- **P0 — Android signing keystore absent.** No `signingConfig`, no `.jks`. Can't generate a signed AAB.
- **P0 — `VITE_REVENUECAT_ANDROID_KEY` read by `iap.ts` but undocumented/unset** → Play Billing silently no-ops; review tests purchases.
- **P0 — Verify `delete-account` is actually deployed** (config ≠ deployed). Apple 5.1.1(v) + Play require working in-app deletion.
- **P1 — `window.confirm()`/`alert()` ×12 across 10 files** fail silently in iOS WKWebView → destructive actions run with no dialog. *Fix:* shadcn `AlertDialog` via a shared promise helper.
- **P1 — RevenueCat → Supabase webhook not wired** (`REVENUECAT_WEBHOOK_SECRET` unset, URL not set) → paid users stay "free."
- **P1 — Android release `minifyEnabled false`; no `google-services.json`** (FCM won't init).
- **P1 — `.env.production.example` documents 1 of ~7 required build vars** (missing `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_REVENUECAT_ANDROID_KEY`, plus edge secrets).
- **P1 — Apply the Telegram digest migration** (`telegram_*_digest` columns) — digest functions error until applied.
- **P2:** Android `versionCode` bump strategy; run `@capacitor/assets generate` for iOS; create App Store IAP products + RevenueCat entitlement `pro`; fill Play Data Safety; set support email/URLs; `index.html lang` *(fixed §6)*; add `VIBRATE` permission.

**Distance to first submission:** Android ≈ 1–2 days of owner console/keystore work; iOS ≈ 2–3 days (Mac + Xcode scaffold is the gating prerequisite). Both assume the accounts you already have.

---

## 5. Owner-gated work (no script can do these)

DB migrations, edge-function deploys, and store-console actions are **not** applied by a git push (per the project's deploy model). These need you:

1. **Mac + Xcode:** `npx cap add ios` → `npx cap sync` → `npx @capacitor/assets generate` → configure Signing & Capabilities (enable In-App Purchase).
2. **Apple:** register App ID `ua.otutorhub.app`; create the App Store Connect listing; create IAP products (`pro_monthly`, optional `pro_yearly`) + the mandatory review screenshot.
3. **Google Play:** create the app; signing keystore + signed AAB → Internal Testing; complete Data Safety; content rating; support email + privacy/terms URLs.
4. **RevenueCat:** project + iOS/Android apps; entitlement `pro`; offering `default`; copy SDK keys into the build env; set the Supabase webhook URL + secret.
5. **Supabase:** set secrets (`REVENUECAT_WEBHOOK_SECRET`, `OAUTH_STATE_SECRET`, confirm LiqPay keys); deploy `delete-account`; apply the Telegram digest migration **and** the `lesson_details` protection migration.
6. **Firebase:** add Android app → `google-services.json` → `android/app/`.
7. **Security hygiene:** rotate the `.env.e2e` password + cron shared secret.

A precise click-by-click runbook for all of this is task #10.

---

## 6. Fixed in code this session (frontend, safe, gates-green)

Applied in your working copy and verified against **all four gates + a production build**. They ship to prod when you Publish.

| File | Change |
|---|---|
| `vite.config.ts` | Split `@radix-ui/*` + misc UI libs off the 619 kB critical-path chunk → 446 kB; >500 kB warning gone |
| `src/components/ui/card.tsx` | `rounded-lg` → `rounded-[16px]` |
| `src/components/ui/button.tsx` | `rounded-md` → `rounded-[12px]` (base + sm/lg) |
| `src/components/ui/select.tsx` | `rounded-md` → `rounded-xl` (match `Input`) |
| `src/components/ui/textarea.tsx` | `rounded-md` → `rounded-xl` (match `Input`) |
| `index.html` | `lang="en"` → `lang="uk"` |

Post-change gate results: `tsc` ✅ 0 · `vitest` ✅ 133/133 · `check-i18n` ✅ 3318 · `check-ux` ✅ 0 err / 8 warn · `vite build` ✅.

---

## 7. Recommended next batches (in priority order)

1. **iOS-correctness:** replace all `confirm()`/`alert()` with `AlertDialog` (promise helper) — highest-impact app bug.
2. **Positive empty states + token colors:** fix the 3 empty states; route off-palette greys/greens through tokens; darken `--sub` for AA; add aria-labels/roles; raise sub-44px touch targets.
3. **Security migrations (drafted, owner-applied):** `lesson_details` financial-write protection; tighten `profiles` read scope; durable rate limit.
4. **Performance:** per-route ErrorBoundaries; begin React Query migration (Schedule → Finances → Dashboard); push PeoplePage/Finances aggregations server-side.
5. **Release packaging:** iOS scaffold + assets; full `.env.production.example`; store metadata/screenshots; submission runbook.
