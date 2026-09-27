/**
 * §4 аудиту шляхів 24.09 (учень): «своєї заявки на перенесення учень скасувати
 * не може» і «"Заявка в роботі" — статус без жодної дії: ні ETA, ні чату, ні
 * скасування».
 *
 * ВАЖЛИВЕ УТОЧНЕННЯ, знайдене 27.09: SQL для цього НЕ потрібен. Політики
 * `Student cancels own pending request` (lesson_change_requests) і
 * `Student deletes own open referral request` (tutor_referral_requests) живуть
 * у базі з квітня — бракувало рівно кнопок. Тому тут поведінкові тести, а не
 * сценарій бази.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── мок бази: записує кожен запис і віддає наперед задані відповіді ──────────
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> };
const calls = vi.hoisted(() => [] as Call[]);
const state = vi.hoisted(() => ({
  pendingRequest: null as null | Record<string, unknown>,
  updateError: null as null | { message: string },
  /** Скільки рядків «повернув» delete: 0 = RLS відкинула МОВЧКИ. */
  deleteRows: 1,
}));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: "mgr-1", error: null })));
const navigate = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const notif = vi.hoisted(() => ({
  insertNotification: vi.fn(async (_arg: { userId: string; type: string; title: string; link?: string }) => {}),
  notifyManagers: vi.fn(async (_arg: { type: string; title: string; link?: string }) => {}),
}));

function mkQuery(table: string) {
  const q: any = { table, op: "select", filters: [] as Array<[string, string, unknown]>, payload: undefined };
  const record = () => calls.push({ table, op: q.op, payload: q.payload, filters: q.filters });
  q.select = () => q;
  q.update = (payload: unknown) => { q.op = "update"; q.payload = payload; return q; };
  q.delete = () => { q.op = "delete"; return q; };
  q.eq = (k: string, v: unknown) => { q.filters.push(["eq", k, v]); return q; };
  q.in = (k: string, v: unknown) => { q.filters.push(["in", k, v]); return q; };
  q.order = () => q;
  q.limit = () => q;
  q.maybeSingle = () => { q.single = true; return q; };
  q.then = (res: (v: unknown) => unknown) => {
    record();
    if (q.op === "update") return Promise.resolve({ error: state.updateError }).then(res);
    if (q.op === "delete") {
      return Promise.resolve({
        data: Array.from({ length: state.deleteRows }, (_, i) => ({ id: `r${i}` })),
        error: null,
      }).then(res);
    }
    return Promise.resolve({ data: q.single ? state.pendingRequest : [], error: null }).then(res);
  };
  return q;
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "s1", email: "olia@example.com" }, roles: ["student"], loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => mkQuery(t), rpc },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/notifications", () => notif);
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import { StudentLessonActions } from "@/components/StudentLessonActions";
import { TutorRequestStatusCard } from "@/components/student/TutorRequestStatusCard";

beforeEach(() => {
  calls.length = 0;
  state.pendingRequest = null;
  state.updateError = null;
  state.deleteRows = 1;
  rpc.mockClear(); navigate.mockClear();
  toastMock.success.mockClear(); toastMock.error.mockClear();
  notif.insertNotification.mockClear(); notif.notifyManagers.mockClear();
  rpc.mockImplementation(async () => ({ data: "mgr-1", error: null }));
});

const future = new Date(Date.now() + 86_400_000).toISOString();

describe("учень скасовує СВОЮ заявку на зміну уроку", () => {
  const show = () =>
    render(
      <MemoryRouter>
        <StudentLessonActions lessonId="l1" tutorId="t1" startsAt={future} status="scheduled" />
      </MemoryRouter>,
    );

  it("поки заявка висить — є і напис, і кнопка «Скасувати заявку»", async () => {
    state.pendingRequest = { id: "req1", kind: "reschedule", proposed_starts_at: future, status: "pending", reason: null };
    show();
    expect(await screen.findByText("Запит на перенесення")).toBeInTheDocument();
    expect(screen.getByText("Скасувати заявку")).toBeInTheDocument();
  });

  it("дотик пише ЛИШЕ свій рядок і ЛИШЕ статус cancelled", async () => {
    state.pendingRequest = { id: "req1", kind: "cancel", proposed_starts_at: null, status: "pending", reason: null };
    show();
    fireEvent.click(await screen.findByText("Скасувати заявку"));
    await waitFor(() => {
      const upd = calls.find((c) => c.op === "update");
      expect(upd, "оновлення заявки не сталось").toBeTruthy();
      expect(upd!.table).toBe("lesson_change_requests");
      expect(upd!.payload).toEqual({ status: "cancelled" });
      expect(upd!.filters).toEqual([["eq", "id", "req1"], ["eq", "student_id", "s1"]]);
    });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("репетитор дізнається — і тип сповіщення несе УРОК, інакше добовий дедуп зʼїсть друге", async () => {
    state.pendingRequest = { id: "req1", kind: "cancel", proposed_starts_at: null, status: "pending", reason: null };
    show();
    fireEvent.click(await screen.findByText("Скасувати заявку"));
    await waitFor(() => expect(notif.insertNotification).toHaveBeenCalled());
    const arg = notif.insertNotification.mock.calls[0][0];
    expect(arg.userId).toBe("t1");
    expect(arg.type).toBe("lesson_request_withdrawn_l1");
  });

  it("збій запису НЕ прикидається успіхом — напис лишається", async () => {
    state.pendingRequest = { id: "req1", kind: "cancel", proposed_starts_at: null, status: "pending", reason: null };
    state.updateError = { message: "нема звʼязку" };
    show();
    fireEvent.click(await screen.findByText("Скасувати заявку"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByText("Скасувати заявку")).toBeInTheDocument();
  });
});

describe("«Запит у роботі» має дії й час", () => {
  const req = (status: string, daysAgo: number) => ({
    id: "tr1",
    status,
    created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });
  const show = (status = "open", daysAgo = 3) =>
    render(
      <MemoryRouter>
        <TutorRequestStatusCard request={req(status, daysAgo)} onCancelled={() => {}} />
      </MemoryRouter>,
    );

  it("видно, КОЛИ надіслано — це і є відсутній ETA", () => {
    const a = show("open", 3);
    expect(screen.getByText("надіслано 3 дні тому")).toBeInTheDocument();
    a.unmount();
    show("open", 0);
    expect(screen.getByText("надіслано сьогодні")).toBeInTheDocument();
  });

  it("«Написати менеджеру» веде в справжній тред через канонічну RPC", async () => {
    show();
    fireEvent.click(screen.getByText("Написати менеджеру"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("start_manager_chat"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chats?with=mgr-1"));
  });

  it("скасувати можна поки заявка open; коли вже в роботі — кнопки немає", () => {
    const a = show("open");
    expect(screen.getByText("Скасувати запит")).toBeInTheDocument();
    a.unmount();
    /* Взяту в роботу заявку база видалити не дасть (політика вимагає `open`),
       тож кнопки немає — натомість лишається чат, бо там уже є з ким говорити. */
    show("in_progress");
    expect(screen.queryByText("Скасувати запит")).toBeNull();
    expect(screen.getByText("Написати менеджеру")).toBeInTheDocument();
  });

  it("МОВЧАЗНА відмова RLS (0 рядків) — це помилка, а не «скасовано»", async () => {
    /* Головна пастка цього шматка: delete під RLS не повертає помилки, він
       просто нічого не видаляє. Успіх доводиться рядками. */
    state.deleteRows = 0;
    show();
    fireEvent.click(screen.getByText("Скасувати запит"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(notif.notifyManagers).not.toHaveBeenCalled();
  });

  it("справжнє скасування — свій рядок, і менеджер про це знає", async () => {
    show();
    fireEvent.click(screen.getByText("Скасувати запит"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("tutor_referral_requests");
    expect(del.filters).toEqual([["eq", "id", "tr1"], ["eq", "student_id", "s1"]]);
    expect(notif.notifyManagers).toHaveBeenCalled();
  });
});

describe("канон і сітка тижня", () => {
  it("чат із менеджером — ОДНА реалізація на застосунок", () => {
    const lib = read("src/lib/managerChat.ts");
    expect(lib).toMatch(/rpc\("start_manager_chat"\)/);
    const others = ["src/pages/DashboardPage.tsx", "src/components/student/TutorRequestStatusCard.tsx"];
    for (const f of others) {
      expect(read(f), `${f} мусить кликати канон, а не RPC напряму`).not.toMatch(/rpc\("start_manager_chat"\)/);
      expect(read(f)).toMatch(/startManagerChat\(\)/);
    }
  });

  it("сітка тижня: позначити проведеним можна лише МИНУЛИЙ запланований урок", () => {
    const w = read("src/components/WeekCalendar.tsx");
    expect(w).toMatch(/l\.status === "scheduled" &&/);
    expect(w).toMatch(/startD\.getTime\(\) \+ l\.duration_minutes \* 60_000 <= Date\.now\(\)/);
    expect(w, "на низькому чипі кнопка накрила б увесь урок").toMatch(/height >= 40/);
  });

  it("чип більше не <button>: кнопка в кнопці — невалідний HTML і подвійний жест", () => {
    const w = read("src/components/WeekCalendar.tsx");
    expect(w).toMatch(/role="button"\s*\n\s*tabIndex=\{0\}/);
    expect(w).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    expect(w, "збільшена зона дотику — той самий канон tap-44").toMatch(/tap-44/);
  });

  it("статуси з сітки ставить лише репетитор або менеджер, і тим самим каноном", () => {
    const sp = read("src/pages/SchedulePage.tsx");
    expect(sp).toMatch(/onMarkConducted=\{\s*\n?\s*isTutor \|\| isManager \? \(l\) => void updateStatus\(l\.id, "completed"\) : undefined/);
  });
});
