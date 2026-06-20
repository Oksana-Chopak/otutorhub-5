# oTutorHub — Submission Runbook (master checklist)

One ordered path from "code is ready" to "live in both stores." **Order matters.**
Steps marked **🔑 owner-only** need your accounts/Mac and can't be scripted.

Companion docs: `iOS-SETUP-GUIDE.md` (iOS, step-by-step) · `RELEASE-GUIDE.md` (Android + Apple notes) · `STORE-LISTING.md` (all copy & screenshots) · `RELEASE-AUDIT-2026-06-20.md` (why each item).

---

## Phase A — Ship the polished web code

The native apps wrap the **web build**, so the latest web code must be on `main` first.

- [ ] On your Mac, in the project folder, bundle all pending changes and push:
  ```bash
  git rm --cached vite.config.ts.timestamp-*.mjs vitest.config.ts.timestamp-*.mjs 2>/dev/null
  git add -A
  git commit -m "release polish: design-system, perf chunking, iOS-safe dialogs, positive empty states, payout migration"
  git pull --rebase origin main
  git push origin HEAD:main
  ```
- [ ] In **Lovable → Publish** (frontend isn't live in prod until you Publish).
- [ ] Quick look in Lovable **Preview** that pages render (dashboard, people, finances, schedule).

---

## Phase B — Supabase (DB + functions) 🔑

A migration file in the repo is **not live until applied** in Supabase. Apply via the SQL editor or ask Lovable to apply.

- [ ] **Verify / apply migrations** (check `src/integrations/supabase/types.ts` or the Security panel; apply any missing **in ascending timestamp order**):
  - `20260621000000` manager↔independent isolation (P0)
  - `20260622000000` referral-farming + notification spoofing
  - `20260623000000` low-severity hardening
  - `20260626000000` **lesson_details payout protection** ← new from this audit
  - Telegram digest columns (`telegram_*_digest`) + cron
  - `20260618130000_notify_managers_rpc` (if not already live)
  - ⚠️ **Ordering invariant:** every new migration's timestamp must be strictly above the live high-water mark, or Supabase silently skips it.
- [ ] **Set edge-function secrets** (Dashboard → Edge Functions → Secrets): `REVENUECAT_WEBHOOK_SECRET`, `OAUTH_STATE_SECRET`, confirm `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
- [ ] **Deploy / verify edge functions:** `delete-account` (Apple/Play require working in-app deletion — test it), `revenuecat-webhook`, `landing-find-tutor-quiz`.
- [ ] **Security hygiene:** rotate the `.env.e2e` password and the cron shared secret (see audit §1).
- [ ] **Verify isolation (P0):** as a manager using the anon key, `lessons?source=eq.independent` and `student_rates?source=eq.independent` must return **0 rows**.
- [ ] **Verify payout guard:** run the 3-line test at the bottom of `20260626000000_protect_lesson_details_payout.sql` (tutor blocked, manager allowed, independent student-payment still works).

---

## Phase C — RevenueCat + in-app purchases 🔑

- [ ] RevenueCat: create project → add **iOS app** + **Android app** → entitlement `pro` → offering `default` (monthly + optional annual).
- [ ] Copy the **iOS SDK key** → `VITE_REVENUECAT_IOS_KEY`, **Android SDK key** → `VITE_REVENUECAT_ANDROID_KEY` (in your build env / `.env.production`).
- [ ] RevenueCat → Integrations → Webhooks → URL `https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/revenuecat-webhook` with the matching secret.
- [ ] **App Store Connect** → create IAP subscription `pro_monthly` (~330 ₴ tier) + the mandatory review screenshot.
- [ ] **Play Console** → create the subscription product to match.

---

## Phase D — Android build & submit 🔑

Follow `RELEASE-GUIDE.md` §1. Key gaps to close:

- [ ] Create a **signing keystore** in Android Studio; back it up **off-repo** (losing it = can't update the app ever).
- [ ] Add `google-services.json` (Firebase → Android app `ua.otutorhub.app`) at `android/app/`.
- [ ] In `android/app/build.gradle`: set `minifyEnabled true` (release) and a `versionCode` bump plan (increment every upload).
- [ ] `npm run build && npx cap sync android` → Android Studio → **Generate Signed Bundle (AAB)**.
- [ ] Play Console → Internal testing → complete **Data Safety** (draft in `RELEASE-GUIDE.md`), content rating, privacy URL, support email → Production.

---

## Phase E — iOS build & submit 🔑

Follow `iOS-SETUP-GUIDE.md` end-to-end (you said this is your first time — it's written for that). Summary:

- [ ] `npm run build` → `npx cap add ios` → `npx cap sync ios` → `npx @capacitor/assets generate --ios` → `npx cap open ios`.
- [ ] Xcode: Signing (your Team + `ua.otutorhub.app`) → **+ Capability: In-App Purchase**.
- [ ] Test on simulator → **Product → Archive → Distribute → App Store Connect → Upload**.
- [ ] App Store Connect: fill **App Privacy**, attach build, add a **demo reviewer account** (a tutor with sample data) → Submit for Review.

---

## Phase F — Store listings (copy & art)

Everything is drafted in `STORE-LISTING.md` (UA + EN names, descriptions, keywords, categories, promo text).

- [ ] Fill the **support email** (the only real blank).
- [ ] Privacy: `https://otutorhub.com/privacy` · Terms: `https://otutorhub.com/terms` (routes exist in-app).
- [ ] Capture **6–8 screenshots** per the shot list + caption/format spec in `STORE-LISTING.md` (Dashboard, AI lesson card, Finances, Lesson form, Schedule, Rewards).

---

## Phase G — Final pre-submit verification

- [ ] All four gates green on the shipped commit: `npx tsc --noEmit` · `npx vitest run` · `node scripts/check-i18n.mjs` · `node scripts/check-ux.mjs`.
- [ ] On a **real device / simulator**: a destructive action (delete a lesson) now shows the in-app confirm dialog (the iOS WebView fix) — and the two hard deletes require typing "DELETE".
- [ ] In-app **account deletion** works (calls the deployed `delete-account`).
- [ ] A **payment** marks paid with instant feedback; subscription/Pro state reflects after a test purchase (sandbox).
- [ ] No console errors on the main pages; offline banner appears when you kill the network.

---

### Realistic timeline (accounts already exist)
Android → internal testing in ~1–2 days of your console/keystore work. iOS → TestFlight in ~2–3 days (the Xcode scaffold is the gating first step). Then Apple review ~1–3 days; Play review usually faster.
