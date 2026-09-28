// Мутаційне тестування (Stryker) для грошових бібліотек — 27.09.
// Ганяє лише тести, що перевіряють ПОВЕДІНКУ src/lib/{financials,hubPricing,currency,subjects}:
// ратчети, які читають файли репо (штампи, гейти), у пісочниці Stryker бачать інше дерево
// і падають хибно, тож сюди не входять.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/test/financials.test.ts",
      "src/test/money-mutants.test.ts",
      "src/test/debt-model-0904.test.ts",
      "src/test/hub-pricing-invariants.test.ts",
      "src/test/currency*.test.ts",
      "src/test/subjects*.test.ts",
      "src/test/format*.test.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
