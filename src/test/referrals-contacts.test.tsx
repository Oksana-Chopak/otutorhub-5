/**
 * 03.10, скарга власниці: «бачу три нових запити з математики, але як менеджер
 * не бачу контактних даних, щоб написати учню!!! Мене веде на чати, і я маю
 * створити там одразу пару учень-репетитор, а я хочу просто написати тому
 * учневі, бажано на емейл або на номер телефону, щоб спершу домовитися».
 *
 * Дві причини, обидві тут закріплені:
 *  1. Заявка з ЛЕНДІНГУ несе контакти в самій заявці (`lead_name`/`lead_email`/
 *     `lead_phone` — їх пише `landing-find-tutor-quiz`), а сторінка читала лише
 *     `profile_contacts`. Три колонки не читались НІДЕ, тож лід показувався як
 *     безіменний «Учень» без контактів.
 *  2. Контакт був написом із кнопкою «скопіювати», а гучна зелена кнопка вела в
 *     ЧАТ — тобто у крок «створи пару», щоб виконати крок «домовитись». Для ліда
 *     без акаунта чат неможливий узагалі (`student_id` nullable → `?with=null`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "mgr" } }) }));
vi.mock("@/components/AssignTutorDialog", () => ({ AssignTutorDialog: () => null }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => {
  /* Дані живуть ТУТ: `vi.mock` піднімається на верх файлу, тож змінні модуля
     в фабриці ще не існують. */
  const LEAD = {
    id: "req-lead",
    student_id: null,
    source: "landing_quiz",
    lead_name: "Олена Петрівна",
    lead_email: "olena@mail.test",
    lead_phone: "+38 (067) 123-45-67",
    subject: "математика",
    preferred_level: null, budget_note: null, preferred_days: null, preferred_times: null,
    message: null, status: "open", manager_response: null, created_at: "2026-10-03T08:00:00Z",
  };
  const REGISTERED = {
    id: "req-acc",
    student_id: "stud-1",
    source: "app",
    lead_name: null, lead_email: null, lead_phone: null,
    subject: "фізика",
    preferred_level: null, budget_note: null, preferred_days: null, preferred_times: null,
    message: null, status: "open", manager_response: null, created_at: "2026-10-02T08:00:00Z",
  };
  const rows: Record<string, any[]> = {
    tutor_referral_requests: [LEAD, REGISTERED],
    profiles: [{ id: "stud-1", first_name: "Тарас", last_name: "Б", avatar_url: null }],
    profile_contacts: [{ user_id: "stud-1", email: "taras@mail.test", phone: null, telegram: "taras_tg" }],
  };
  const make = (table: string) => {
    const res = { data: rows[table] ?? [], error: null };
    const chain: any = {
      select: () => chain,
      order: () => Promise.resolve(res),
      in: () => Promise.resolve(res),
      eq: () => chain,
      update: () => chain,
    };
    return chain;
  };
  return { supabase: { from: (t: string) => make(t) } };
});

import ReferralsPage from "@/pages/ReferralsPage";

const cardOf = async (name: string) => {
  const title = await screen.findByText(name);
  // Картка — спільний контейнер рядка і розгорнутого блоку.
  let el: HTMLElement | null = title as HTMLElement;
  while (el && !(el.style?.borderRadius === "20px")) el = el.parentElement;
  return el as HTMLElement;
};

describe("запити на репетитора: менеджер може звʼязатись, не створюючи пару", () => {
  beforeEach(() => navigate.mockClear());

  it("лід із лендінгу має ІМʼЯ і КОНТАКТИ з самої заявки", async () => {
    render(<ReferralsPage />);
    // Доти тут було безіменне «Учень», бо lead_name не читався.
    expect(await screen.findByText("Олена Петрівна")).toBeInTheDocument();
    const card = await cardOf("Олена Петрівна");
    expect(within(card).getByText("olena@mail.test")).toBeInTheDocument();
    expect(within(card).getByText("+38 (067) 123-45-67")).toBeInTheDocument();
  });

  it("контакт — це ДІЯ: пошта відкриває лист із темою про предмет, телефон набирає номер", async () => {
    render(<ReferralsPage />);
    const card = await cardOf("Олена Петрівна");
    const mail = within(card).getByText("olena@mail.test").closest("a") as HTMLAnchorElement;
    expect(mail, "рядок пошти мусить бути посиланням, а не написом").toBeTruthy();
    expect(mail.getAttribute("href")).toContain("mailto:olena@mail.test");
    expect(decodeURIComponent(mail.getAttribute("href") ?? ""), "тема листа несе предмет запиту")
      .toContain("математика");
    const tel = within(card).getByText("+38 (067) 123-45-67").closest("a") as HTMLAnchorElement;
    // У tel: лишаються лише цифри й плюс — інакше набір не працює.
    expect(tel.getAttribute("href")).toBe("tel:+380671234567");
  });

  it("для ліда БЕЗ акаунта чату не пропонуємо — він вів би на /chats?with=null", async () => {
    render(<ReferralsPage />);
    const card = await cardOf("Олена Петрівна");
    expect(within(card).queryByRole("button", { name: /Написати$/ })).toBeNull();
    // Але головна дія є — і це пошта.
    expect(within(card).getByRole("link", { name: /Написати на email/ })).toBeInTheDocument();
  });

  it("у зареєстрованого учня контакти з профілю, і чат доступний додатково", async () => {
    render(<ReferralsPage />);
    fireEvent.click(await screen.findByText("фізика"));
    const card = await cardOf("Тарас Б");
    expect(within(card).getByText("taras@mail.test")).toBeInTheDocument();
    const chat = within(card).getByRole("button", { name: /Написати/ });
    fireEvent.click(chat);
    expect(navigate).toHaveBeenCalledWith("/chats?with=stud-1");
  });
});
