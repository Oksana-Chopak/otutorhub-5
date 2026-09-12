/**
 * Картка «мій тиждень з помічником» (12.09) — те, що людина може переслати
 * колезі, не соромлячись. Рішення власниці 10.09: НІЯКИХ сум грошей (в
 * українській культурі заробіток напоказ не виставляють), імен теж немає —
 * лише кількість учнів і зустрічей, дні й час, і головна обіцянка продукту:
 * «0 разів "нагадую про оплату" — це робить помічник».
 *
 * Малюється Canvas 2D без бібліотек: 1080×1350 (4:5 — стрічка Instagram і
 * будь-який месенджер показують без обрізання). Усі підписи приходять уже
 * перекладеними — тут лише геометрія.
 */
export interface ShareCardInput {
  title: string;          // «Мій тиждень з помічником»
  students: string;       // «5 учнів»
  lessons: string;        // «20 зустрічей за 4 тижні»
  scheduleTitle: string;  // «Розклад тижня»
  scheduleLines: string[];// «Пн · 16:00, 18:00», … (без імен)
  promise: string;        // «0 разів «нагадую про оплату» — це робить помічник»
  site: string;           // «otutorhub.com»
}

const W = 1080;
const H = 1350;
const FONT = "'Golos Text', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(probe).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = probe;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawShareCard(canvas: HTMLCanvasElement, input: ShareCardInput): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Тло — той самий темний градієнт, що й у дайджесті на лендінгу.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0f0f1a");
  bg.addColorStop(1, "#1a1f3a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Мʼяка пляма акценту вгорі праворуч.
  const glow = ctx.createRadialGradient(W - 160, 120, 20, W - 160, 120, 520);
  glow.addColorStop(0, "rgba(43,191,170,.35)");
  glow.addColorStop(1, "rgba(43,191,170,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const pad = 88;
  let y = 150;

  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("☀️ oTutorHub", pad, y);

  y += 96;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 64px ${FONT}`;
  for (const line of wrap(ctx, input.title, W - pad * 2)) { ctx.fillText(line, pad, y); y += 76; }

  // Дві великі цифри — картками.
  y += 30;
  const cardW = (W - pad * 2 - 28) / 2;
  const cardH = 200;
  for (const [i, label] of [input.students, input.lessons].entries()) {
    const x = pad + i * (cardW + 28);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundRect(ctx, x, y, cardW, cardH, 28);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    const m = label.match(/^(\S+)\s+(.*)$/);
    ctx.font = `800 84px ${FONT}`;
    ctx.fillText(m ? m[1] : label, x + 34, y + 110);
    if (m) {
      ctx.font = `600 32px ${FONT}`;
      ctx.fillStyle = "rgba(255,255,255,.8)";
      for (const line of wrap(ctx, m[2], cardW - 68).slice(0, 2)) { ctx.fillText(line, x + 34, y + 160); y += 0; }
    }
  }
  y += cardH + 56;

  // Розклад — лише дні й час.
  if (input.scheduleLines.length > 0) {
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fillText(`📅 ${input.scheduleTitle}`, pad, y);
    y += 14;
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    for (const line of input.scheduleLines.slice(0, 7)) {
      y += 54;
      ctx.fillText(line, pad, y);
    }
    y += 40;
  }

  // Обіцянка — на бірюзовій підкладці одразу під змістом (щоб між розкладом
  // і нею не зяяла порожнеча), але не нижче за смугу з адресою сайту.
  const promiseY = Math.min(Math.max(y + 24, 640), H - 300);
  ctx.fillStyle = "rgba(43,191,170,.18)";
  roundRect(ctx, pad, promiseY, W - pad * 2, 150, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 36px ${FONT}`;
  let py = promiseY + 62;
  for (const line of wrap(ctx, input.promise, W - pad * 2 - 68).slice(0, 2)) { ctx.fillText(line, pad + 34, py); py += 46; }

  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(input.site, pad, H - 80);
}

export function shareCardBlob(input: ShareCardInput): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      drawShareCard(canvas, input);
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch { resolve(null); }
  });
}
