# 🛂 App Review Notes — готові тексти для копіювання

> Це те, що рецензенти Apple/Google читають перед перевіркою. Скопіюй у відповідне поле.
> ⚠️ ОБОВ'ЯЗКОВО створи демо-акаунт із реальними даними (кілька учнів, уроків, оплат) і встав логін/пароль — без робочого тестового акаунта застосунок майже завжди відхиляють.

---

## App Store Connect → App Review Information → Notes
(англійською — рецензенти Apple читають EN)

```
oTutorHub is a workspace for private tutors: lesson scheduling, payment tracking,
AI-generated lesson summaries, in-app chat with students, and Google Calendar sync.

ACCOUNT FOR REVIEW
Email: <email справжнього демо-акаунта — ще НЕ створений; створимо разом і впишемо сюди>
Password: <встав сюди>
This account is a tutor with sample students, lessons and payments so you can see
all features.

SUBSCRIPTION (v1 — IMPORTANT)
Pro is sold via Apple In-App Purchase (auto-renewable, monthly and yearly).
"Restore Purchases" is available on the Subscription screen. There are no external
payment links inside the iOS app.
[Якщо релізиш v1 БЕЗ IAP — заміни абзац вище на:]
Pro is provisioned by our administrators outside the app. The iOS build contains
no purchase flow or pricing — the Subscription screen only shows feature
information. No external payment links are present in the iOS app.

ACCOUNT DELETION
Users can delete their account in-app: Profile → Danger zone → Delete account
(double confirmation). It permanently removes their personal data.

SIGN-IN
The iOS build uses email/password sign-in (Google OAuth is intentionally hidden in
native builds because Google blocks OAuth inside web views).

NOTES
Some content is in Ukrainian (primary market). Core flows are visible from the
sample data above. Contact: <твій support email>.
```

---

## Google Play Console → App content → нотатки для рев'ю / тестовий доступ
(те саме, коротше; додай у "App access" тестовий акаунт)

```
oTutorHub — workspace for private tutors (schedule, payments, AI lesson notes,
chat, Google Calendar).

TEST ACCOUNT (App access → All functionality):
Email: <email справжнього демо-акаунта — ще НЕ створений; створимо разом і впишемо сюди>
Password: <встав сюди>
Tutor account with sample students, lessons and payments.

Account deletion is available in-app: Profile → Danger zone → Delete account.
Subscription (Pro) is handled via LiqPay on Android; "manager-assisted" options
are also available for users who can't pay by card.
```

---

## Apple Privacy «Nutrition Label» — що відмічати (App Store Connect → App Privacy)
Data collected, linked to the user, NOT used for tracking:
- **Contact Info:** Name, Email, Phone — App Functionality.
- **User Content:** Messages (chat), Other (lesson notes/homework) — App Functionality.
- **Identifiers:** User ID — App Functionality.
- **Financial Info:** Other (lesson prices/payment status, no card data — payments handled by LiqPay/Apple) — App Functionality.
Tracking: **No**. We do not use data to track across other apps/sites.

## Google Play «Data safety» — що відмічати
- Збираємо: Name, Email, Phone (optional), In-app messages, App activity (lessons/payments).
- Мета: App functionality (та account management).
- Шифрування в передачі: **Yes** (HTTPS/Supabase).
- Видалення даних: **Yes** — користувач може видалити акаунт у застосунку.
- Продаж/шеринг третім для реклами: **No**.

---

## Часті причини відхилення — і що ми вже закрили
| Ризик | Статус |
|---|---|
| Немає видалення акаунта (Apple 5.1.1) | ✅ Закрито (Danger zone) |
| Зовнішня оплата цифрової підписки на iOS (3.1.1) | ✅ Закрито (IAP, або повністю прихована оплата) |
| Google OAuth у webview ламається | ✅ Закрито (прихований у нативі) |
| Немає тестового акаунта | ⚠️ Зроби демо-акаунт із даними |
| Privacy policy URL недоступний | ⚠️ Перевір, що /privacy відкривається публічно |
| Порожній/демо-вигляд застосунку | ⚠️ Заповни демо-акаунт реальними прикладами |
