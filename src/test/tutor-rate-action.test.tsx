/**
 * 21.09 — розрив у флоу, який побачила власниця: Telegram каже «ставку не
 * задано», картка уроку каже те саме, а дотик відкривав ДЕТАЛІ уроку, де ставки
 * немає. Тепер «ставку не задано» — ДІЯ: з картки, з деталей уроку, з «Людей» і
 * з кнопки дайджесту відкривається ОДНА форма ставки репетитора, з репетитором
 * і предметом уроку вже підставленими, а збереження тягне бекфіл виплат.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── мок бази: ланцюжок supabase-js, що записує upsert/delete/rpc ────────────
type Call = { table: string; op: string; rows?: unknown; filters?: unknown[] };
const calls: Call[] = [];
const details: { subjects: string[]; rate_per_lesson: number } | null = { subjects: ["Німецька"], rate_per_lesson: 300 };
const subjectRates: Array<{ subject: string; rate_per_lesson: number }> = [{ subject: "Німецька", rate_per_lesson: 300 }];
// Скільки перших select-ів падає: 2 = саме читання форми, а пізніші (під час
// збереження) вже проходять — як на мобільному звʼязку, що ожив.
const failLoad = { v: 0 };

function mkQuery(table: string) {
  const q: any = { table, op: "select", filters: [] as unknown[] };
  q.select = () => q;
  q.upsert = (rows: unknown) => { q.op = "upsert"; calls.push({ table, op: "upsert", rows }); return q; };
  q.delete = () => { q.op = "delete"; return q; };
  q.eq = (k: string, v: unknown) => { q.filters.push(["eq", k, v]); return q; };
  q.in = (k: string, v: unknown) => { q.filters.push(["in", k, v]); calls.push({ table, op: "delete", rows: v }); return q; };
  q.maybeSingle = () => { q.single = true; return q; };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    let out: unknown = { data: null, error: null };
    if (q.op === "select" && table === "tutor_details") out = { data: details, error: null };
    if (q.op === "select" && table === "tutor_subject_rates") out = { data: subjectRates, error: null };
    if (failLoad.v > 0 && q.op === "select") { failLoad.v--; out = { data: null, error: { message: "network" } }; }
    return Promise.resolve(out).then(res, rej);
  };
  return q;
}
const { rpc, toast } = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: unknown) => ({ data: 2, error: null })),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => mkQuery(t), rpc: (n: string, a: unknown) => rpc(n, a) } }));
vi.mock("@/components/PayoutScheduleCard", () => ({ PayoutScheduleCard: () => null }));
vi.mock("sonner", () => ({ toast }));

import { LessonCard } from "@/components/LessonCard";
import { TutorRateDialog, mergeSubjects } from "@/components/TutorRateDialog";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const lesson = { id: "l1", subject: "Математика", starts_at: "2026-09-21T10:00:00Z", duration_minutes: 60, tutor_payout: 0, student_price: 600, status: "completed" as const };

beforeEach(() => { calls.length = 0; failLoad.v = 0; rpc.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });

describe("картка уроку: «ставку не задано» — дія, а не напис", () => {
  it("менеджер + без виплати + onSetRate → кнопка «Задати ставку», яка НЕ відкриває урок", () => {
    const onSetRate = vi.fn();
    const onContentClick = vi.fn();
    render(<LessonCard lesson={lesson} role="manager" tutorName="Петро Городний" studentName="Оля" onSetRate={onSetRate} onContentClick={onContentClick} />);
    const btn = screen.getByRole("button", { name: "Задати ставку репетитору Петро Городний" });
    expect(btn.textContent).toContain("Ставку не задано — виплата не порахована");
    expect(btn.textContent).toContain("Задати ставку");
    fireEvent.click(btn);
    expect(onSetRate).toHaveBeenCalledTimes(1);
    expect(onContentClick).not.toHaveBeenCalled();
  });
  it("без хендлера — той самий напис, без кнопки (інші ролі й сторінки не змінились)", () => {
    render(<LessonCard lesson={lesson} role="manager" studentName="Оля" />);
    expect(screen.getByText("Ставку репетитора не задано — виплата не порахована")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Задати ставку/ })).toBeNull();
  });
  it("виплата є → жодної кнопки ставки", () => {
    render(<LessonCard lesson={{ ...lesson, tutor_payout: 300 }} role="manager" studentName="Оля" onSetRate={vi.fn()} />);
    expect(screen.queryByText(/Ставку репетитора не задано/)).toBeNull();
  });
});

describe("TutorRateDialog — одна форма ставки", () => {
  it("читає ставки сама, додає предмет уроку без ставки, зберігає і тягне бекфіл виплат", async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<TutorRateDialog open tutorId="t1" presetSubject="Математика" onOpenChange={onOpenChange} onSaved={onSaved} />);
    // предмет уроку зʼявився рядком і підписаний «без ставки»; чинна ставка на місці
    const mathInput = await screen.findByLabelText("напр. 350: Математика");
    expect((mathInput as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/без ставки/)).toBeInTheDocument();
    expect((screen.getByLabelText("напр. 350: Німецька") as HTMLInputElement).value).toBe("300");

    fireEvent.change(mathInput, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ backfilled: 2 }));
    const td = calls.find((c) => c.table === "tutor_details" && c.op === "upsert")!.rows as { subjects: string[] };
    expect(td.subjects).toEqual(["Німецька", "Математика"]);
    const sr = calls.find((c) => c.table === "tutor_subject_rates" && c.op === "upsert")!.rows as Array<{ subject: string; rate_per_lesson: number }>;
    expect(sr).toEqual([{ tutor_id: "t1", subject: "Німецька", rate_per_lesson: 300 }, { tutor_id: "t1", subject: "Математика", rate_per_lesson: 250 }]);
    expect(rpc).toHaveBeenCalledWith("backfill_tutor_payouts_for_tutor", { _tutor_id: "t1" });
    expect(toast.success).toHaveBeenCalledWith("Ставку застосовано до 2 неоплачених уроків");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // нічого не видалено: обидва предмети лишились
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(0);
  });
  it("порожня ставка не зберігається мовчки — помилка словами, база не чіпається", async () => {
    render(<TutorRateDialog open tutorId="t1" presetSubject="Математика" onOpenChange={vi.fn()} />);
    await screen.findByLabelText("напр. 350: Математика");
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("22.09: ставки не прочитались → зберігається ЛИШЕ введене; чужі ставки й список предметів не чіпаються", async () => {
    failLoad.v = 2;
    const onSaved = vi.fn();
    render(<TutorRateDialog open tutorId="t1" presetSubject="Математика" onOpenChange={vi.fn()} onSaved={onSaved} />);
    const mathInput = await screen.findByLabelText("напр. 350: Математика");
    expect(toast.error).toHaveBeenCalledWith("Не вдалося завантажити ставки репетитора — перевірте звʼязок і спробуйте ще раз.");
    expect(screen.getByRole("status").textContent).toContain("інші ставки репетитора не зміняться");
    fireEvent.change(mathInput, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // список предметів НЕ перезаписано — інакше «Німецька» зникла б із профілю
    expect(calls.filter((c) => c.table === "tutor_details" && c.op === "upsert")).toHaveLength(0);
    // нічого не видалено — інакше ставка «Німецької» 300 тихо зникла б
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(0);
    const sr = calls.find((c) => c.table === "tutor_subject_rates" && c.op === "upsert")!.rows;
    expect(sr).toEqual([{ tutor_id: "t1", subject: "Математика", rate_per_lesson: 250 }]);
    expect(rpc).toHaveBeenCalledWith("backfill_tutor_payouts_for_tutor", { _tutor_id: "t1" });
  });
  it("22.09: без прочитаних ставок і без жодної суми — помилка словами, база не чіпається", async () => {
    failLoad.v = 2;
    render(<TutorRateDialog open tutorId="t1" presetSubject="Математика" onOpenChange={vi.fn()} />);
    await screen.findByLabelText("напр. 350: Математика");
    toast.error.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("mergeSubjects: «Англійська» і «англійська » — один предмет; ставки поза subjects не губляться", () => {
    expect(mergeSubjects(["Англійська"], ["англійська ", "Математика"], [null, "математика"])).toEqual(["Англійська", "Математика"]);
  });
});

describe("розтяжки: усі входи ведуть в одну форму", () => {
  it("«Люди» більше не тримають власної копії форми ставки", () => {
    const pp = read("src/pages/PeoplePage.tsx");
    expect(pp).toMatch(/<TutorRateDialog/);
    expect(pp, "тіло форми живе лише в TutorRateDialog").not.toMatch(/dialogTutorRateDesc/);
    expect(pp, "?open=<id>&rate=1 відкриває форму напряму").toMatch(/searchParams\.get\("rate"\) === "1"/);
    expect(pp).not.toMatch(/backfill_tutor_payouts_for_tutor/);
  });
  it("дашборд, розклад і деталі уроку дають картці дію", () => {
    expect(read("src/pages/DashboardPage.tsx").match(/onSetRate=\{setRateOf\(lesson\)\}/g)?.length, "три рендери картки на дашборді").toBe(3);
    expect(read("src/pages/SchedulePage.tsx")).toMatch(/onSetRate=\{isManager && lesson\.source !== "independent"/);
    const ld = read("src/components/LessonDetailsDialog.tsx");
    expect(ld).toMatch(/student_payment_status, tutor_payout, meeting_url/);
    expect(ld).toMatch(/<TutorRateDialog/);
  });
  it("кнопка «⚙️ Ставка» з дайджесту веде прямо у форму", () => {
    const d = read("supabase/functions/tutor-daily-digest/index.ts");
    expect(d).toMatch(/\/people\?open=\$\{tid\}&rate=1\$\{subj\}/);
    expect(d, "предмет для форми береться з уроків без суми").toMatch(/select\("id, tutor_id, student_id, subject, source, status/);
  });
  it("TutorRateDialog зберігає лише через канон: бекфіл після ставки, EXECUTE service_role не чіпається", () => {
    const dlg = read("src/components/TutorRateDialog.tsx");
    expect(dlg).toMatch(/backfill_tutor_payouts_for_tutor/);
    expect(dlg).not.toMatch(/pick_tutor_payout/);
  });
});
