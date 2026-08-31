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
