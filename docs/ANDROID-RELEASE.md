# Android-реліз: порядок збірки

1. `npm ci && npm run build` — свіжий dist/.
2. `npx cap sync android` — **обовʼязково** після будь-якої зміни залежностей
   (реєструє нативні модулі: @capacitor/app, RevenueCat) і перед кожним релізом.
3. `android/key.properties` з реквізитами keystore (сам keystore — поза гітом).
   Без файлу збірка release тепер **падає одразу** з підказкою (М7), а не
   мовчки видає непідписаний .aab.
4. `cd android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/`.

Origin WebView задано як `https://otutorhub.com` (capacitor.config.ts → server)
— email-підтвердження і /join/* посилання ведуть на живий сайт (М5).

5. **App Links (після першого завантаження в Play Console):**
   Console → Setup → App integrity → App signing → скопіюй **SHA-256** →
   встав замість TODO у `public/.well-known/assetlinks.json` → Publish сайту.
   Після цього https://otutorhub.com/join/* відкривається одразу в застосунку.

6. **Пуші (Firebase / FCM):**
   - Firebase Console → створити/відкрити проєкт → Add app → **Android**,
     package `ua.otutorhub.app` → завантажити `google-services.json`
     → покласти в `android/app/` (шаблон Capacitor підхопить його сам).
   - Там же: Project settings → Service accounts → Generate new private key
     → **вміст JSON цілком** вставити в Lovable → Edge Function Secrets як
     `FCM_SERVICE_ACCOUNT_JSON`.
   - Без цих двох кроків збірка й веб-пуші працюють як раніше: нативна
     гілка `send-push` просто пропускається з одним рядком у логах.
