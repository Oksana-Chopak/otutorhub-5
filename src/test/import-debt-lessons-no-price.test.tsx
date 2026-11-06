/**
 * «Борг 2 уроки» без ціни — наживо, до самого натискання кнопки (06.11).
 *
 * Скарга: таких учнів нібито показують у превʼю із зеленою галочкою, рахують у
 * кнопці «Додати N учнів» — і не створюють, і ніхто не каже, кого саме втрачено.
 * Цей тест тисне кнопку і дивиться, що насправді пішло в базу: учень
 * СТВОРЮЄТЬСЯ, борг уроками лишається словами в нотатці (бо без ціни його нема
 * з чого порахувати) — і людина чує ІМЕНА тих, кому треба дописати ціну.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  upserts: [] as Array<Record<string, unknown>>,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() },
}));
const { rpc, upserts, toast } = h;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      upsert: (row: Record<string, unknown>) => { h.upserts.push(row); return Promise.resolve({ error: null }); },
    }),
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "tutor-1" } }) }));
vi.mock("@/hooks/useCoreLock", () => ({ useCoreLock: () => ({ locked: false, openPaywall: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/calendarBackSync", () => ({ backSyncImportedLessons: () => Promise.resolve(0) }));

import { ImportStudentsSheet } from "@/components/ImportStudentsSheet";

beforeEach(() => {
  rpc.mockReset();
  upserts.length = 0;
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockResolvedValue({ data: { student_id: "s-new", action: "created", debt_total: 0, scheduled: 0 }, error: null });
});

async function importText(text: string) {
  render(<ImportStudentsSheet open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Перенести все, що є/ }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^Додати/ }));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
}

const argsFor = (name: string) =>
  rpc.mock.calls.find((c) => (c[1] as Record<string, unknown>)?._first_name === name)?.[1] as Record<string, unknown> | undefined;

describe("імпорт: «борг N уроків» без ціни", () => {
  it("учня СТВОРЕНО, а не тихо пропущено", async () => {
    await importText("Соня — борг 2 уроки");
    const a = argsFor("Соня");
    expect(a, "виклик на створення Соні мусить бути").toBeTruthy();
    expect(a!._price, "ціни не було — нічого не вигадуємо").toBe(0);
    expect(a!._debt_lessons, "борг уроками без ціни база відбиває — не надсилаємо його").toBe(0);
    expect(a!._debt_amount, "суми боргу не було").toBe(0);
    expect(toast.success).toHaveBeenCalled();
    expect(String(toast.success.mock.calls[0][0])).toMatch(/Додано учнів: 1/);
  });

  it("борг не зникає безслідно — лишається словами в нотатці про учня", async () => {
    await importText("Соня — борг 2 уроки");
    await waitFor(() => expect(upserts.length).toBe(1));
    expect(String(upserts[0].notes)).toMatch(/борг 2 уроки — ціна не вказана/);
    expect(upserts[0].student_id).toBe("s-new");
  });

  it("людина чує ІМЕНА тих, кому дописати ціну, а не лише число", async () => {
    await importText("Соня — борг 2 уроки\nМаша — 600 — борг 1200");
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const said = String(toast.warning.mock.calls[0][0]);
    expect(said, "саме Соня").toMatch(/Соня/);
    expect(said, "Маша з ціною сюди не потрапляє").not.toMatch(/Маша/);
    expect(said).toMatch(/немає ціни/);
    // і в Маші борг пішов сумою, а не уроками
    expect(argsFor("Маша")!._debt_amount).toBe(1200);
  });

  it("є ціна — борг стає сумою одразу, нотатки немає", async () => {
    await importText("Соня — 450 — борг 2 уроки");
    const a = argsFor("Соня")!;
    expect(a._price).toBe(450);
    expect(a._debt_amount, "2 × 450 — борг зводиться до однієї одиниці, грошей").toBe(900);
    expect(a._debt_lessons, "уроками борг уже не йде — він порахований").toBe(0);
    expect(toast.warning, "попереджати нема про що").not.toHaveBeenCalled();
    expect(upserts.length, "нотатки про «ціна не вказана» немає").toBe(0);
  });

  it("хто справді не додався — поіменно й окремо від тих, у кого лише немає ціни", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await importText("Соня — борг 2 уроки\nМаша — 600 — борг 1200");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/Не вдалося додати: Соня/);
  });
});
