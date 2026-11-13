/**
 * Спільне для keyboard-walk і every-button: «екранна клавіатура» і перевірка полів під нею.
 * Чому це взагалі потрібно — у шапці keyboard-walk.mjs.
 */
import { mkdirSync } from "node:fs";

export const KB = Number(process.env.KB_HEIGHT ?? 336);          // типова клавіатура на екрані 390×844
export const OUT = process.env.KB_OUT ?? "/tmp/keyboard-walk";
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Передати в ctx.addInitScript: видима висота зменшується, сторінка — ні (так це бачить сайт на телефоні). */
export function kbInit() {
  const vv = window.visualViewport;
  if (!vv || window.__kb) return;
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), "height");
  let kb = 0;
  Object.defineProperty(vv, "height", { configurable: true, get() { return d.get.call(vv) - kb; } });
  window.__kb = (h) => { kb = h; vv.dispatchEvent(new Event("resize")); };
}

/** Стає в кожне текстове поле верхньої форми (або сторінки), «відкриває клавіатуру» і звіряє. Повертає кількість полів. */
export async function kbCheck(page, where, findings, opts = {}) {
  const say = opts.quiet ? () => {} : (m) => console.log(m);
  const fields = await page.evaluate(() => {
    document.querySelectorAll("[data-kb]").forEach((e) => e.removeAttribute("data-kb"));
    const layers = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
    const root = layers[layers.length - 1] || document.querySelector("main") || document.body;
    const out = []; let i = 0;
    for (const el of root.querySelectorAll("input, textarea, [contenteditable='true']")) {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "checkbox", "radio", "file", "range", "color", "button", "submit"].includes(type)) continue;
      if (el.disabled || el.readOnly) continue;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 20 || r.height < 12 || cs.visibility === "hidden" || cs.display === "none") continue;
      el.setAttribute("data-kb", String(i));
      const lab = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText) || el.closest("label")?.innerText || el.getAttribute("name") || el.tagName;
      out.push({ i, label: String(lab).replace(/\s+/g, " ").trim().slice(0, 40) });
      i++;
    }
    return { fields: out, inDialog: layers.length > 0 };
  });
  if (!fields.fields.length) { say(`   (полів немає)`); if (process.env.KB_SHOTS) await page.screenshot({ path: `${OUT}/NOFIELDS_${where.replace(/[^a-zа-яіїє0-9]+/gi, "_")}.png` }).catch(() => {}); return 0; }
  let bad = 0;
  for (const f of fields.fields) {
    const el = page.locator(`[data-kb="${f.i}"]`).first();
    try { await el.scrollIntoViewIfNeeded({ timeout: 1500 }); await el.click({ timeout: 2000 }); } catch { continue; }
    await page.evaluate((h) => window.__kb(h), KB); await wait(650);
    const res = await page.evaluate(({ i, KB }) => {
      const el = document.querySelector(`[data-kb="${i}"]`);
      if (!el) return null;
      const vb = innerHeight - KB;
      const r = el.getBoundingClientRect();
      const out = [];
      if (r.bottom > vb + 1) out.push(`поле під клавіатурою (низ поля ${Math.round(r.bottom)}, видимо до ${vb})`);
      else if (r.top < -1) out.push(`поле виїхало за верх екрана (${Math.round(r.top)})`);
      else {
        const t = document.elementFromPoint(r.left + Math.min(r.width / 2, 60), r.top + r.height / 2);
        const lab = t?.closest?.("label");
        if (t && !(t === el || el.contains(t) || t.contains(el) || (lab && lab.contains(el)))) out.push(`поле накрите «${(t.innerText || t.tagName).replace(/\s+/g, " ").trim().slice(0, 24)}»`);
      }
      const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
      const d = ds[ds.length - 1];
      if (d && d.contains(el)) {
        const dr = d.getBoundingClientRect();
        if (dr.bottom > vb + 1) out.push(`низ форми під клавіатурою на ${Math.round(dr.bottom - vb)}px`);
        if (dr.top < -1) out.push(`верх форми за екраном (${Math.round(dr.top)})`);
        // кнопки липкого підвалу/шапки (ті, що не гортаються разом із вмістом) мусять лишатись на екрані
        const scrolls = (x) => { for (let a = x.parentElement; a; a = a.parentElement) { const oy = getComputedStyle(a).overflowY; if ((oy === "auto" || oy === "scroll") && a.scrollHeight > a.clientHeight + 4) return true; if (a === d) break; } return false; };
        for (const b of d.querySelectorAll("button")) {
          const br = b.getBoundingClientRect(); const cs = getComputedStyle(b);
          if (br.width < 30 || br.height < 20 || cs.visibility === "hidden" || cs.display === "none" || scrolls(b)) continue;
          if (br.bottom > vb + 1 || br.top < -1) { out.push(`кнопка «${(b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 22)}» поза видимою частиною`); break; }
        }
      }
      return out;
    }, { i: f.i, KB });
    if (process.env.KB_SHOTS && f.i === Number(process.env.KB_SHOT_FIELD ?? fields.fields.length - 1)) {
      // знімок із намальованою «клавіатурою» — щоб людина могла подивитись очима
      await page.evaluate((KB) => { const k = document.createElement("div"); k.id = "__kbd"; k.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${KB}px;background:#cfd3da;z-index:2147483647;display:flex;align-items:center;justify-content:center;font:600 18px system-ui;color:#555;border-top:1px solid #9aa`; k.textContent = "⌨ клавіатура"; document.documentElement.appendChild(k); }, KB);
      await page.screenshot({ path: `${OUT}/${where.replace(/[^a-zа-яіїє0-9]+/gi, "_")}.png` }).catch(() => {});
      await page.evaluate(() => document.getElementById("__kbd")?.remove());
    }
    if (res && res.length) {
      bad++; findings.push(`${where} · «${f.label}»: ${res.join("; ")}`);
      say(`   ✗ «${f.label}»: ${res.join("; ")}`);
      if (bad === 1) await page.screenshot({ path: `${OUT}/${where.replace(/[^a-zа-яіїє0-9]+/gi, "_")}.png` }).catch(() => {});
    }
    await page.evaluate(() => { window.__kb(0); document.activeElement?.blur?.(); }); await wait(250);
  }
  say(`   полів ${fields.fields.length} · під клавіатурою ${bad}`);
  return fields.fields.length;
}

