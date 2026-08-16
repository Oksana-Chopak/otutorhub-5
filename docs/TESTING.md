# Тестова драбина oTutorHub (зафіксовано 10.08.2026)

## Рівень 1 — Юніт: грошова математика = 100%
Уся грошова логіка живе в чистих лібах і ТІЛЬКИ там (інваріант CLAUDE.md):
`src/lib/financials.ts`, `hubPricing.ts`, `currency.ts`, `subjects.ts`.
Покриття: **100% рядків / 100% функцій / 100% гілок** (єдиний виняток —
задокументований недосяжний захисний guard із `c8 ignore`).
Перевірити:
`npm i -D @vitest/coverage-v8 && npx vitest run --coverage --coverage.include='src/lib/financials.ts' --coverage.include='src/lib/hubPricing.ts' --coverage.include='src/lib/currency.ts' --coverage.include='src/lib/subjects.ts'`

## Рівень 2 — Мутаційні тести (тих самих лібів)
Конфіг: `stryker.config.json` (272 мутанти по 4 файлах, поріг break=70).
Разово поставити рушій і запустити:
`npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner @vitest/coverage-v8 && npx stryker run`
(Рушій свідомо НЕ в package.json — щоб не роздувати прод-залежності;
у хмарній пісочниці прогін 272 мутантів не вкладається, ганяти з Mac.)
Скор фіксуємо тут після кожного прогону.

## Рівень 3 — Інтеграційні розтяжки (вже в батареї кожного коміту)
`hub-pricing-invariants.test.ts` (7 розтяжок: префіли, крос-фолбеки, бекфіл,
settle/guard-тригери, канонізація), `security-invariants.test.ts`,
`db-surface-invariants.test.ts` — валять збірку при регресі архітектури.

## Рівень 4 — E2E (Playwright, живий прод)
З Mac: `npm run test:e2e` (потрібен `.env.e2e` у папці проєкту; у git не потрапляє).

## Політика «100% на все»
100% юніт+мутації на ~200 UI-компонентів ≈ тижні роботи і суттєвий usage без
пропорційної користі. Зафіксований бар: гроші/безпека/дані — 100% + мутації +
розтяжки; UI — e2e-смоук критичних флоу. Розширення бару — рішенням власниці.
