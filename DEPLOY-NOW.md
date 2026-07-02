# Deploy checklist — do in this order

Three separate channels. **`git push` + Publish ships ONLY the frontend.** Migrations and
edge functions are deployed separately (via Lovable chat or Supabase). Re-doing an
already-done migration/redeploy is harmless.

---

## STEP 1 — Frontend (ships ALL UI changes at once)

```
cd ~/Desktop/otutorhub-5
git add -A
git commit -m "batch: reminders bell + group reminders, sizing, pricing 249, remove dead widget"
git pull --rebase origin main
git push origin HEAD:main
```
Then in Lovable click **Publish**. Hard-refresh the app (Cmd+Shift+R) or open Incognito.

**This one push+Publish ships everything visual:** hub dashboard (manager-style row),
student pages on the shared dark sidebar + golden bell, bigger buttons/fields (44px) and
numbers (30px), the "mark all paid" instant-feedback fix, and the 249₴/unlimited copy.

✅ Verify: open the tutor dashboard on desktop — the top cards match the manager's, and
buttons/inputs look bigger. If nothing changed → the Publish didn't pick up latest `main`
(re-Publish / check Lovable Preview).

---

## STEP 2 — Migrations (tell Lovable to apply; Publish does NOT)

Say to Lovable: **"Apply these migrations in order, then regenerate types."**

1. `20260711000000_platform_superadmin.sql` — *(likely already applied — `platform_admins`
   is already live; re-running is skipped)*
2. `20260712000000_safe_rpc_manager_payout.sql` — lets a manager mark a payment
3. `20260713000000_grant_select_payout_schedule_cols.sql` — payout schedule stops "flying off"

✅ Verify #2: as manager, mark a lesson paid → no "Не вдалося оновити оплату".
✅ Verify #3: open a tutor's payout schedule, set it, reload → it stays.

---

## STEP 3 — Edge functions (tell Lovable to redeploy; Publish does NOT)

Say to Lovable: **"Redeploy these edge functions."**

**Must (changed now — reminders):**
- `remind-payment` — manual "Нагадати" now also writes the in-app 🔔
- `payment-reminders` — hourly auto-reminder now writes 🔔 for everyone **and covers group lessons**

**Only if you haven't already redeployed these from earlier:**
- `payout-reminders`, `scheduled-notifications` — Telegram payout/income reminders (moved-column fix)
- `admin-stats` — the /admin superadmin panel
- `landing-spots-left` — "N місць" counter (tutors only)

✅ Verify reminders: mark a lesson unpaid → tap "Нагадати" → the student's 🔔 lights up.

---

## STEP 4 — AI conspects: verify deploy + secrets (Supabase dashboard, only you can)

The DB half is live and the code is complete, but AI notes only work if BOTH are true:

1. **Functions deployed** — Supabase Dashboard → **Edge Functions** → confirm these are listed:
   `fireflies-webhook`, `fireflies-start-recording`, `fireflies-auto-join`,
   `generate-lesson-summary`. If missing → tell Lovable to deploy them.
2. **Secrets set** — Supabase Dashboard → **Project Settings → Edge Functions → Secrets** →
   confirm these exist (add if missing):
   - `FIREFLIES_API_KEY` — your Fireflies API key
   - `FIREFLIES_WEBHOOK_SECRET` — any strong random string
   - `TELEGRAM_BOT_TOKEN` — (also used by reminders)
3. **Fireflies webhook URL** — in your Fireflies account, point the webhook to your
   `fireflies-webhook` function URL (…/functions/v1/fireflies-webhook).

✅ Verify: on a lesson, tap **"✨ AI"** → a summary generates (needs Pro/trial + the key).

---

## STEP 5 — Final smoke check

- Security: as a manager, an anon-key probe of `lessons?source=eq.independent` returns **0 rows**.
- Reminder → student 🔔 works (Step 3).
- AI summary generates (Step 4).

That's it. Steps 1–3 are the routine three channels; Steps 4–5 are one-time setup + verification.
