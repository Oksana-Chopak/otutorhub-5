// Weekly digest — every Monday 08:00 Kyiv.
// Shows last week stats + upcoming week. All roles: tutors, managers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAllRows } from "../_shared/fetchAll.ts";
import {
  detailsOf,
  paidStudentIncome,
  paidTutorPayout,
  unpaidTutorPayout,
  unpaidStudentDebt,
} from "../_shared/digestMoney.ts";
import { withJob } from "../_shared/jobRun.ts";
import { versionProbe } from "../_shared/build.ts";

const TZ = "Europe/Kyiv";
const SUPABASE_URL = "https://kficbcjqcbhqhjimxfed.supabase.co";

function weekBoundsKyiv(): { from: string; to: string; label: string } {
  const now = new Date();
  const kyivStr = now.toLocaleString("en-CA", { timeZone: TZ });
  const today = new Date(kyivStr.split(",")[0]);
  // Start of current week (Monday)
  const dow = (today.getDay() + 6) % 7; // Mon=0
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  // Last week: Mon to Sun
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastSun = new Date(monday); lastSun.setDate(monday.getDate() - 1);

  const fmt = (d: Date, h: number) => {
    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
    const kyivH = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", hour12: false,
    }).format(probe));
    const offset = kyivH - 12;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - offset, 0, 0)).toISOString();
  };

  const label = `${lastMon.getDate()}-${lastSun.getDate()} ${
    lastSun.toLocaleString("uk-UA", { month: "long", timeZone: TZ })
  }`;

  return { from: fmt(lastMon, 0), to: fmt(lastSun, 24), label };
}

function nextWeekBoundsKyiv(): { from: string; to: string } {
  const now = new Date();
  const kyivStr = now.toLocaleString("en-CA", { timeZone: TZ });
  const today = new Date(kyivStr.split(",")[0]);
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const nextMon = new Date(monday); nextMon.setDate(monday.getDate());
  const nextSun = new Date(monday); nextSun.setDate(monday.getDate() + 6);
  const fmt = (d: Date, h: number) => {
    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
    const kyivH = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", hour12: false,
    }).format(probe));
    const offset = kyivH - 12;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - offset, 0, 0)).toISOString();
  };
  return { from: fmt(nextMon, 0), to: fmt(nextSun, 24) };
}

async function sendTg(token: string, chatId: number, text: string): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML",
      disable_web_page_preview: true }),
  });
  return r.ok;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(withJob("tutor-weekly-digest", async (req) => {
  /* 01.10: проба версії СТОЇТЬ ПЕРШОЮ — без даних і до будь-якої перевірки
     доступу. Доти цю cron-функцію ззовні неможливо було спитати, чи вона
     передеплоєна: робот бачив лише пʼять функцій із пробою, а саме у кронів
     застарілий код непомітний — вони відповідають однаково. */
  const probe = versionProbe(req, "tutor-weekly-digest");
  if (probe) return probe;
  const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!BOT || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";
  const sb = createClient(SUPABASE_URL, serviceKey);
  const { data: expected } = await sb.rpc("get_cron_shared_secret");
  if (!provided || !expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const { from, to, label } = weekBoundsKyiv();
  const { from: nFrom, to: nTo } = nextWeekBoundsKyiv();

  // Telegram links
  const { data: tgAll } = await sb
    .from("user_telegram_links")
    .select("user_id, chat_id")
    .not("chat_id", "is", null);
  const chatById = new Map<string, number>(
    (tgAll ?? []).filter((r: any) => r.chat_id).map((r: any) => [r.user_id, Number(r.chat_id)])
  );
  if (chatById.size === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no telegram users" }));
  }

  const userIds = Array.from(chatById.keys());

  // Profiles, roles
  const { data: profiles } = await sb.from("profiles")
    .select("id, first_name").in("id", userIds);
  const firstName = new Map<string, string>(
    (profiles ?? []).map((p: any) => [p.id, (p.first_name ?? "").trim() || "там"])
  );
  const { data: roles } = await sb.from("user_roles")
    .select("user_id, role").in("user_id", userIds);
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of roles ?? []) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Set());
    rolesByUser.get(r.user_id)!.add(r.role);
  }

  /* 27.09: три читання нижче — «по всій платформі», тож ЛИШЕ сторінками
     (інваріант EDGE READS PAGE, 22.09). Без цього PostgREST віддавав максимум
     ~1000 рядків БЕЗ помилки: тижневий підсумок тихо недорахував би і уроки, і
     борги, а людина отримала б це як факт. `.order("id")` обовʼязковий —
     інакше сторінки перекриваються. */
  const lastWeekRes = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, lesson_details(student_price, student_payment_status, tutor_payout_status, tutor_payout)")
    .eq("status", "completed")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("id")
    .range(a, b));
  const lastWeek = lastWeekRes.data;

  const nextWeekRes = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, source")
    .eq("status", "scheduled")
    .gte("starts_at", nFrom)
    .lt("starts_at", nTo)
    .order("id")
    .range(a, b));
  const nextWeek = nextWeekRes.data;

  // Unpaid debts — модель 04.09: проведене АБО скасоване зі штрафом (сюди ж
  // лягають перенесені борги з імпорту, 07.09). Раніше — лише completed.
  const unpaidRes = await fetchAllRows<any>((a, b) => sb
    .from("lessons")
    .select("id, tutor_id, student_id, source, status, lesson_details!inner(student_price, student_payment_status, tutor_payout, tutor_payout_status, is_cancellation_fee)")
    .in("status", ["completed", "cancelled"])
    .eq("lesson_details.student_payment_status", "unpaid")
    .gt("lesson_details.student_price", 0)
    .order("id")
    .range(a, b));
  const unpaidRaw = unpaidRes.data;
  /* Збій читання грошей НЕ перетворюється на «боргів немає» — це той самий
     інваріант, що врятував ранковий дайджест 22.09. */
  const moneyReadFailed = !!(lastWeekRes.error || unpaidRes.error);
  const unpaid = (unpaidRaw ?? []).filter((l: any) => {
    const d = Array.isArray(l.lesson_details) ? l.lesson_details[0] : l.lesson_details;
    return l.status === "completed" || d?.is_cancellation_fee === true;
  });

  // Student names for debt list
  const debtStudentIds = Array.from(new Set((unpaid ?? []).map((l: any) => l.student_id)));
  const { data: debtStudents } = debtStudentIds.length
    ? await sb.from("profiles").select("id, first_name, last_name").in("id", debtStudentIds)
    : { data: [] };
  const studentName = new Map<string, string>(
    (debtStudents ?? []).map((p: any) => [
      p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень",
    ])
  );

  // Школи (модель «школа = сутність», 07.09): менеджер бачить підсумки лише
  // СВОЄЇ школи. До застосування етапу A таблиці немає — тоді все хабове.
  const { data: hubMgrRows, error: hubErr } = await sb.from("hub_managers").select("user_id, hub_id");
  const hubModel = !hubErr;
  const hubOfManager = new Map<string, string>((hubMgrRows ?? []).map((r: any) => [r.user_id, r.hub_id]));
  const { data: hubTutorRows } = hubModel
    ? await sb.from("tutor_workspace_settings").select("tutor_id, hub_id").not("hub_id", "is", null)
    : { data: [] as any[] };
  const hubOfTutor = new Map<string, string>((hubTutorRows ?? []).map((r: any) => [r.tutor_id, r.hub_id]));
  /* САМОСТІЙНІСТЬ читаємо з прапорця, а НЕ з hub_id: тригер `set_default_hub_id`
     штампує id єдиної школи будь-якому рядку налаштувань, створеному без
     прапорця, і пізніший UPDATE прапорця hub_id не чистить (пастка 26.09).
     Від цього залежить, ЧИЇ гроші показати репетитору — свою виплату чи
     виручку школи. */
  /* 01.10: це читання «по всій платформі» йшло звичайним `.select()` — тобто
     обрізалось на ~1000 рядків БЕЗ помилки (інваріант EDGE READS PAGE), і
     репетиторів за межею сторінки персона не мала взагалі. Три інші платформені
     читання в цьому файлі вже сторінками; це лишалось єдиним. */
  const wsRes = await fetchAllRows<any>((a, b) => sb.from("tutor_workspace_settings")
    .select("tutor_id, independent_workspace")
    .order("tutor_id")
    .range(a, b));
  if (wsRes.error) console.error("tutor-weekly-digest: персони не прочитані —", wsRes.error);
  const isIndependentTutorOf = new Map<string, boolean>(
    (wsRes.data ?? []).map((r: any) => [r.tutor_id, r.independent_workspace === true]),
  );
  const inManagerHub = (managerId: string, tutorId: string) =>
    !hubModel || hubOfTutor.get(tutorId) === hubOfManager.get(managerId);

  let sent = 0;

  for (const userId of userIds) {
    const chatId = chatById.get(userId);
    if (!chatId) continue;
    const userRoles = rolesByUser.get(userId) ?? new Set();
    const isManager = userRoles.has("manager");
    const isTutor = userRoles.has("tutor");
    if (!isManager && !isTutor) continue;

    const name = firstName.get(userId) ?? "";
    const lines: string[] = [];

    if (isManager) {
      const mine = (l: any) => l.source !== "independent" && inManagerHub(userId, l.tutor_id);
      const wLessons = (lastWeek ?? []).filter(mine);
      const nLessons = (nextWeek ?? []).filter(mine);
      /* 27.09: «Зароблено» рахувало ціни ВСІХ проведених уроків — разом із
         неоплаченими. Ті самі гроші зʼявлялись нижче ще раз як «борги учнів»,
         тобто тиждень виглядав удвічі прибутковішим, ніж був. Тепер тут лише
         те, що СПРАВДІ отримано (дзеркало `paidIncome` у застосунку). */
      const income = paidStudentIncome(wLessons);
      const wDebts = (unpaid ?? []).filter(mine);
      const debtTotal = unpaidStudentDebt(wDebts);
      const debtStudents = new Set(wDebts.map((l: any) => l.student_id)).size;

      lines.push(`📊 <b>Тиждень ${label} — підсумки центру</b>`);
      lines.push("");
      lines.push(`🏫 Проведено: <b>${wLessons.length} уроків</b>`);
      lines.push(`💰 Зароблено: <b>${income} ₴</b>`);
      if (debtStudents > 0) {
        lines.push("");
        lines.push(`💳 Борги учнів: ${debtStudents} учнів · <b>${debtTotal} ₴</b>`);
        const top = Array.from(
          wDebts.reduce((m: Map<string, number>, l: any) => {
            const k = l.student_id;
            m.set(k, (m.get(k) ?? 0) + Number(detailsOf(l)?.student_price ?? 0));
            return m;
          }, new Map<string, number>())
        ).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [sid, amt] of top) {
          lines.push(`  • ${esc(studentName.get(sid))} — ${amt} ₴`);
        }
      }
      lines.push("");
      lines.push(`📅 Наступний тиждень: <b>${nLessons.length} уроків</b> — вперед! 💪`);
      lines.push("");
      lines.push(`Гарного тижня, ${esc(name)}! 💪`);

    } else {
      const wLessons = (lastWeek ?? []).filter((l: any) => l.tutor_id === userId);
      const nLessons = (nextWeek ?? []).filter((l: any) => l.tutor_id === userId);
      /* 27.09, той самий клас, що дефект ранкового дайджесту (закритий 22.09):
         ХАБОВОМУ репетитору тут показувалась ціна учня — тобто виручка ШКОЛИ й
         витік її маржі, а не гроші репетитора. Самостійний бачить свої оплати,
         хабовий — свою виплату. І в обох випадках лише ОТРИМАНЕ.

         01.10: сама формула була правильна, а ПЕРСОНА — ні. Прапорець читався
         через «не дорівнює false», тобто «не знаю → самостійний», і витік
         відкривався знову. «Не знаю» було не теорією:
         рядка налаштувань могло не бути (дірка 26.09, бекфіл покрив лише тих,
         хто вже в `hub_members`), читання того рядка йшло БЕЗ `fetchAllRows`
         (обрізалось на ~1000 рядків без помилки) і без `error`.
         Тому гроші більше не залежать від одного прапорця на людину: кожен
         урок рахується за ВЛАСНИМ `source` — той самий канон, що в ранковому й
         вечірньому дайджестах. Змішаний випадок (репетитор у школі, який веде
         ще й своїх учнів) тепер теж правильний, а не «безпечно неправильний». */
      const myDebts = (unpaid ?? []).filter((l: any) => l.tutor_id === userId);
      const ownLessons = wLessons.filter((l: any) => l.source === "independent");
      const hubLessons = wLessons.filter((l: any) => l.source !== "independent");
      const ownDebts = myDebts.filter((l: any) => l.source === "independent");
      // «Зароблено» = ОТРИМАНЕ: свої оплати за свої уроки + виплати за хабові.
      const income = paidStudentIncome(ownLessons) + paidTutorPayout(hubLessons);
      /* Хабовому «очікують оплати» — це НЕ борги учнів перед школою (чужі
         гроші), а його невиплачені виплати. */
      const pendingPayout = unpaidTutorPayout(hubLessons);
      const debtTotal = unpaidStudentDebt(ownDebts);
      const debtStudents = new Set(ownDebts.map((l: any) => l.student_id)).size;
      /* Прапорець лишається ЛИШЕ для формулювання рядка. Коли уроків немає
         зовсім, беремо рядок налаштувань, і «не знаю» = ХАБОВИЙ — безпечний
         бік, той самий, що у Фінансах (`FinancesPage`: немає рядка → хабовий). */
      const independent = wLessons.length > 0 || myDebts.length > 0
        ? ownLessons.length + ownDebts.length >= hubLessons.length
        : isIndependentTutorOf.get(userId) === true;

      // Always send, even if no lessons

      lines.push(`🎉 <b>Тиждень ${label}</b> — завершено!`);
      lines.push("");
      lines.push(`📚 Проведено: <b>${wLessons.length} уроків</b>`);
      if (income > 0) {
        lines.push(independent
          ? `💰 Зароблено: <b>${income} ₴</b>`
          : `💰 Отримано виплат: <b>${income} ₴</b>`);
      }
      if (!independent && pendingPayout > 0) {
        lines.push(`⏳ Очікує виплати: <b>${pendingPayout} ₴</b>`);
      }
      if (debtStudents > 0) {
        lines.push("");
        lines.push(`💳 Очікують оплати: ${debtStudents} учнів · <b>${debtTotal} ₴</b>`);
        const top = Array.from(
          myDebts.reduce((m: Map<string, number>, l: any) => {
            const k = l.student_id;
            m.set(k, (m.get(k) ?? 0) + Number(detailsOf(l)?.student_price ?? 0));
            return m;
          }, new Map<string, number>())
        ).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [sid, amt] of top) {
          lines.push(`  • ${esc(studentName.get(sid))} — ${amt} ₴`);
        }
      }
      lines.push("");
      if (nLessons.length > 0) {
        lines.push(`📅 Наступний тиждень: <b>${nLessons.length} уроків</b> — вперед! 💪`);
      } else {
        lines.push(`📅 Наступного тижня поки порожньо — чудова нагода запланувати нове 🗓️`);
      }
      lines.push("");
      lines.push(`Гарного тижня, ${esc(name)}! 🌟`);
    }

    /* Гроші не прочитались — кажемо це словами. «0» тут читається як «усе
       закрито» і саме так обманув би людину (інваріант 22.09). */
    if (moneyReadFailed) lines.push("", "⚠️ Суми цього тижня перевірити не вдалося — зайдіть у «Фінанси».");

    const ok = await sendTg(BOT, chatId, lines.join("\n"));
    if (ok) sent++;
  }

  return new Response(JSON.stringify({ ok: true, week: label, sent }), {
    headers: { "Content-Type": "application/json" },
  });
}));
