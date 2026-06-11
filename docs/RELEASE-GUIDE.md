# 🚀 Реліз у App Store та Play Market — покроково

## Що вже зроблено в коді (цей репозиторій)
- ✅ Capacitor: `capacitor.config.ts` (appId `ua.otutorhub.app`), Android-проєкт у `android/`, нативні іконки/splash згенеровані з `resources/`.
- ✅ PWA: `manifest.webmanifest`, повний набір іконок, `store-icon-1024.png` для сторів.
- ✅ App Store 3.1.1: в iOS-збірці приховані LiqPay, ціни та банківський фолбек (`isIosApp()`); Android/web — без змін.
- ✅ Google-вхід прихований у нативних збірках (Google блокує OAuth у webview); email-вхід працює.
- ✅ Видалення акаунта: `supabase/functions/delete-account` + «Небезпечна зона» в обох профілях (вимога Apple 5.1.1(v) і Google Play).
- Скрипти: `npm run cap:sync` (білд+синк), `npm run cap:android` (відкрити в Android Studio).

## Твої кроки

### 0. Безпека (перед усім)
- [ ] Відкликати GitHub-токен, що світився в чаті: GitHub → Settings → Developer settings → Tokens.
- [ ] Задеплоїти функцію: `supabase functions deploy delete-account` (через Lovable це станеться при публікації, якщо функції деплояться разом — перевір у Supabase → Edge Functions, що `delete-account` зʼявилась). Перевір кнопку «Видалити акаунт» на тестовому користувачі.

### 1. Android (простіший — почни з нього)
1. Локально: `git pull`, `npm i`, `npm run cap:android` → відкриється Android Studio.
2. Build → Generate Signed Bundle (AAB). Створи keystore і **збережи його надійно** (втрата = неможливість оновлювати застосунок).
3. Play Console → Create app → завантаж AAB у Internal testing.
4. Анкета Data safety (чернетка відповідей):
   - Збираємо: імʼя, email, телефон (опц.), повідомлення в чаті, фінансові записи уроків — для функціонала застосунку; не продаємо, не шеримо третім сторонам для реклами.
   - Дані шифруються при передачі (HTTPS/Supabase), користувач може запросити видалення (in-app delete).
- [ ] Privacy policy URL: https://<твій-домен>/privacy.
5. Внутрішнє тестування на своєму телефоні → потім Production.

### 2. iOS (потрібен Mac з Xcode)
1. На Mac: `npx cap add ios`, далі `npm run cap:sync`, `npx cap open ios`.
2. У Xcode: Signing & Capabilities → твій Apple Developer Team; Push Notifications capability (на майбутнє).
3. Іконки: `npx @capacitor/assets generate --ios` (resources/ вже в репо).
4. App Store Connect → New App (bundle `ua.otutorhub.app`).
5. App Privacy (чернетка): Contact Info (name, email, phone) — App Functionality; User Content (messages, notes) — App Functionality; не використовуються для трекінгу.
6. Review notes для Apple: «Subscription is provisioned by the service administrators outside the app; the iOS build contains no purchase flow.» + тестовий акаунт (логін/пароль) — обовʼязково дай їм демо-репетитора з даними.
7. TestFlight → собі на телефон → сабміт.

### 3. Скріншоти/тексти для обох сторів
- 6–8 скріншотів з мобільного вебу (375×812 або з симулятора): Дашборд, Розклад, Картка уроку з AI, Фінанси, Форма уроку, Учнівські нагороди.
- Короткий опис (80 зн.) і повний — можу написати, скажи.

### 4. v1.1 (після релізу)
- In-App Purchase для Pro на iOS за **330 ₴/міс** (RevenueCat + StoreKit) — тоді покупка повернеться на iOS легально.
- Нативні пуші (FCM/APNs) поверх наявного web-push бекенда.
- Deep links для листів скидання пароля в застосунок.

## Відомі обмеження v1
- iOS: підписка купується поза застосунком (вимога Apple до зовнішніх оплат).
- Нативні збірки: вхід лише email (Google-вхід доступний у вебі).
