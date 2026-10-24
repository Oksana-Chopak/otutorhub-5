import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = join(__dirname, "../..");
const DIR = join(ROOT, ".github", "workflows");

/**
 * 24.10: усі ранкові прогони CI з 20.10 були червоні, а прод — справний. GitHub
 * переводить мітку `ubuntu-latest` на Ubuntu 26.04 (з 19.10), а Playwright із
 * lockfile не має збірки Chromium для «ubuntu26.04-x64»: `npx playwright install`
 * падав на кроці Install за 7 с, і робот не доходив до жодної перевірки. Ворота
 * браузера не ставлять — їм байдуже. Правило: завдання, яке ставить браузер
 * Playwright, бігає на ПРИБИТІЙ версії образу (ubuntu-24.04), доки Playwright у
 * lockfile не підтримує новіший. Підняли Playwright і він знає Ubuntu 26 —
 * тоді й лише тоді повертайте latest (і цей тест).
 */
describe("воркфлоу: завдання з браузером Playwright не бігають на ubuntu-latest", () => {
  const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
  for (const f of files) {
    const doc = yaml.load(readFileSync(join(DIR, f), "utf8")) as { jobs?: Record<string, { "runs-on"?: unknown; steps?: { run?: string }[] }> };
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const installsBrowser = (job.steps ?? []).some((s) => /playwright install/.test(String(s.run ?? "")));
      if (!installsBrowser) continue;
      it(`${f} → ${jobName}: runs-on прибито, не ubuntu-latest`, () => {
        expect(String(job["runs-on"])).not.toBe("ubuntu-latest");
        expect(String(job["runs-on"])).toMatch(/^ubuntu-\d\d\.\d\d$/);
      });
    }
  }
  it("є принаймні одне завдання з браузером (інакше тест нічого не стереже)", () => {
    const n = files.reduce((acc, f) => {
      const doc = yaml.load(readFileSync(join(DIR, f), "utf8")) as { jobs?: Record<string, { steps?: { run?: string }[] }> };
      return acc + Object.values(doc?.jobs ?? {}).filter((j) => (j.steps ?? []).some((s) => /playwright install/.test(String(s.run ?? "")))).length;
    }, 0);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
