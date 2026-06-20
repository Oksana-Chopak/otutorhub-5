# Як створити iOS-застосунок oTutorHub — покроково (для першого разу)

Цей гайд проведе тебе від нуля до білда в App Store Connect. Усе робиться **на Mac**. Команди можна копіювати й вставляти в Terminal (Cmd+V → Enter). Якщо щось червоніє або незрозуміло — стоп, напиши мені, проведу наживо.

> Важливо розуміти: iOS-застосунок — це «обгортка» навколо веб-застосунку. Тому **спершу свіжий веб-білд, потім iOS**. Після будь-якої зміни коду треба повторити `npm run build && npx cap sync ios`, інакше в застосунку буде стара версія.

---

## 0. Що потрібно (одноразово)

- **Mac** ✅ (у тебе є)
- **Apple Developer акаунт** ✅ (у тебе є) — потрібен, щоб підписати застосунок
- **Xcode** — безкоштовно з Mac App Store (~10–15 ГБ, став заздалегідь, це довго). Після встановлення відкрий його раз, прийми ліцензію.
- **Node.js** — перевір у Terminal: `node -v` (має показати версію). Якщо ні — постав з nodejs.org.

Відкрити Terminal: натисни **Cmd+Пробіл**, набери `Terminal`, Enter.

---

## 1. Свіжий код у проєкті

```bash
cd ~/Desktop/otutorhub-5
```
(якщо проєкт в іншій папці — підправ шлях; можна перетягнути папку в Terminal після `cd `)

```bash
git pull --rebase origin main
npm install
npm run build
```

- `git pull` — підтягнути найновіший код (включно з моїми правками, коли ти їх запушиш — див. чат).
- `npm run build` — зібрати веб-версію в папку `dist/`.

Якщо `git pull` напише про конфлікти — **стоп, напиши мені**.

---

## 2. Інструменти для iOS (одноразово)

```bash
sudo gem install cocoapods
npm install @capacitor/ios
```

- CocoaPods — менеджер залежностей для iOS. `sudo` попросить **пароль від Mac** (під час введення пароль не видно — це нормально).
- Якщо `gem install` лається — спробуй `brew install cocoapods` (потрібен Homebrew з brew.sh).

---

## 3. Створити iOS-проєкт

```bash
npx cap add ios
npx cap sync ios
```

- `cap add ios` — створює папку `ios/` з нативним проєктом.
- `cap sync ios` — копіює туди веб-білд і нативні плагіни (Supabase, RevenueCat тощо).

---

## 4. Іконки та екран запуску

```bash
npx @capacitor/assets generate --ios
```

Це згенерує всі розміри іконок і сплеш-екран з `resources/icon.png` та `resources/splash.png` (вони вже є в проєкті).

---

## 5. Відкрити в Xcode

```bash
npx cap open ios
```

Xcode відкриється сам. Перший запуск довго індексує (внизу буде смужка прогресу) — зачекай, поки затихне.

---

## 6. Підпис (Signing) — найважливіше

У Xcode зліва, у списку файлів, натисни найвищий пункт **App** (синя іконка). Відкриється вкладка налаштувань. Вибери вкладку **Signing & Capabilities** (вгорі).

1. Постав галочку **Automatically manage signing**.
2. **Team** — вибери свій Apple Developer акаунт.
   - Якщо списку немає: **Add an Account…** → увійди своїм Apple ID (тим, на який оформлено Developer).
3. **Bundle Identifier** має бути рівно: `ua.otutorhub.app`
4. Якщо зʼявиться червоне про *provisioning profile* — зачекай 10–20 сек, Xcode створить профіль сам. Якщо не зникає — натисни **Try Again**.

---

## 7. Capabilities (можливості)

На тій самій вкладці **Signing & Capabilities** натисни **+ Capability** (зліва вгорі) і додай:

- **In-App Purchase** — обовʼязково (підписка Pro через App Store).

(Push-сповіщення додамо пізніше, у версії 1.1 — для першої подачі не потрібні.)

---

## 8. Базові налаштування

Вкладка **General** (вгорі):

- **Display Name**: `oTutorHub`
- **Version**: `1.0.0`
- **Build**: `1` (це число треба збільшувати щоразу перед новим завантаженням: 1 → 2 → 3…)
- **Minimum Deployments / iOS**: лиши як є (зазвичай iOS 14).

---

## 9. Перевірка на симуляторі

1. Вгорі по центру Xcode вибери пристрій, напр. **iPhone 15**.
2. Натисни ▶ (**Run**, або Cmd+R).
3. Запуститься симулятор iPhone із застосунком. Потести: відкрий екрани, спробуй увійти, понатискай кнопки — переконайся, що все працює.

Перевірити на справжньому iPhone (необовʼязково, але корисно): підключи телефон кабелем, вибери його у списку пристроїв, Run. Перший раз телефон попросить «довіряти» цьому компʼютеру + у Налаштуваннях iPhone → Загальні → VPN та керування пристроєм підтвердити розробника.

---

## 10. Архів і завантаження в App Store Connect

1. Вгорі замість симулятора вибери **Any iOS Device (arm64)**.
2. Меню **Product → Archive** (збирає реліз-версію; кілька хвилин).
3. Відкриється вікно **Organizer** → твій архів → кнопка **Distribute App**.
4. Вибери **App Store Connect → Upload** → далі-далі (підпис автоматичний) → **Upload**.
5. Через 10–30 хв білд зʼявиться в App Store Connect (вкладка **TestFlight**). На пошту може прийти лист, якщо щось не так.

---

## 11. Оформлення в App Store Connect (у браузері)

Зайди на **appstoreconnect.apple.com** → **My Apps** → **+** → **New App**:

- Platform: **iOS**
- Name: **oTutorHub**
- Primary Language: **Ukrainian**
- Bundle ID: вибери зі списку **ua.otutorhub.app**
- SKU: будь-який, напр. `otutorhub-ios`

Потім заповни (тексти й скріншоти я підготую в окремому файлі — це пункт плану 4):

- Опис, ключові слова, категорія **Education**, вікове обмеження.
- **Privacy Policy URL**: `https://otutorhub.com/privacy`
- **Support URL**: `https://otutorhub.com` (або сторінка підтримки).
- **App Privacy** — анкета про збір даних.
- **In-App Purchases** — створити підписку `pro_monthly` (звʼязати з RevenueCat — окремий крок).
- Вибрати завантажений білд → **Submit for Review**.

Рев'ю Apple зазвичай 1–3 дні. Можуть написати з питаннями — це нормально, відповідаємо й донадсилаємо.

---

## 12. Часті проблеми

- **«No account for team» / помилка підпису** → Xcode → Settings → Accounts → **+** → Apple ID.
- **CocoaPods / pod install падає** → `cd ios/App && pod install` вручну; або перевстанови CocoaPods.
- **«Command PhaseScriptExecution failed»** → ти забула `npm run build` або `npx cap sync ios`. Зроби обидва й повтори.
- **У застосунку стара версія** → завжди `npm run build && npx cap sync ios` перед Archive.
- **Build не зʼявляється в App Store Connect** → зачекай 30 хв; перевір пошту Apple про помилки обробки.

---

## Шпаргалка (після першого налаштування)

Щоразу, коли є нові зміни коду й треба новий білд:

```bash
cd ~/Desktop/otutorhub-5
git pull --rebase origin main
npm install
npm run build
npx cap sync ios
npx cap open ios
```
Потім у Xcode: підняти **Build** на +1 → **Product → Archive → Distribute**.

---

### Я можу допомогти наживо
Скажи коли будеш за Mac — проведу екраном: Xcode я бачу й можу показувати, а команди для Terminal покладу тобі в буфер обміну, щоб ти лише вставила (Cmd+V) і натиснула Enter.
