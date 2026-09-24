/**
 * 24.09 (аудит шляхів): реєстрація через Google робила з репетитора УЧНЯ —
 * OAuth не несе нашої ролі, тож база ставила «учень» за замовчуванням, і людина
 * з лендінгу для репетиторів опинялась в учнівському застосунку без дороги назад
 * (ролі міняє лише менеджер). Тут стережемо і поведінку діалогу, і те, що намір
 * запамʼятовується ДО переходу в Google, і що база не пускає зайвого.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

const mockAuth = vi.hoisted(() => ({ roles: ["student"] as string[], refreshRoles: vi.fn(async () => {}) }));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: "ok", error: null })));
const navigate = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, roles: mockAuth.roles, refreshRoles: mockAuth.refreshRoles, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import { ClaimTutorRoleDialog, SIGNUP_ROLE_KEY } from "@/components/ClaimTutorRoleDialog";

const renderDialog = () => render(<MemoryRouter><ClaimTutorRoleDialog /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  mockAuth.roles = ["student"];
  rpc.mockClear(); navigate.mockClear(); mockAuth.refreshRoles.mockClear();
  toastMock.success.mockClear(); toastMock.error.mockClear();
  rpc.mockImplementation(async () => ({ data: "ok", error: null }));
});

describe("вхід через Google: роль питають, а не вгадують", () => {
  it("реєструвався як репетитор, а роль учнівська → питання + claim_tutor_role", async () => {
    localStorage.setItem(SIGNUP_ROLE_KEY, "tutor");
    renderDialog();
    const btn = await screen.findByText("Я репетитор — веду уроки");
    fireEvent.click(btn);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_tutor_role"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding"));
    expect(mockAuth.refreshRoles).toHaveBeenCalled();
    expect(localStorage.getItem(SIGNUP_ROLE_KEY)).toBeNull();
  });

  it("«я учень» — нічого не міняємо і більше не питаємо", async () => {
    localStorage.setItem(SIGNUP_ROLE_KEY, "tutor");
    renderDialog();
    fireEvent.click(await screen.findByText("Я учень — навчаюсь"));
    await waitFor(() => expect(localStorage.getItem(SIGNUP_ROLE_KEY)).toBeNull());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("база відмовила (акаунт не свіжий) → кажемо словами, а не мовчимо", async () => {
    localStorage.setItem(SIGNUP_ROLE_KEY, "tutor");
    rpc.mockImplementation(async () => ({ data: "has_data", error: null }));
    renderDialog();
    fireEvent.click(await screen.findByText("Я репетитор — веду уроки"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("хто вже репетитор — питання не бачить", () => {
    localStorage.setItem(SIGNUP_ROLE_KEY, "tutor");
    mockAuth.roles = ["tutor"];
    renderDialog();
    expect(screen.queryByText("Я репетитор — веду уроки")).toBeNull();
    expect(localStorage.getItem(SIGNUP_ROLE_KEY)).toBeNull();
  });

  it("хто входив без наміру «репетитор» — питання не бачить", () => {
    renderDialog();
    expect(screen.queryByText("Я репетитор — веду уроки")).toBeNull();
  });
});

describe("вхід через Google: намір і межі бази", () => {
  it("намір запамʼятовується ДО переходу в Google", () => {
    const auth = src("src/pages/AuthPage.tsx");
    const fn = auth.slice(auth.indexOf("const handleGoogleSignIn"), auth.indexOf("const handleGoogleSignIn") + 700);
    expect(fn).toMatch(/rememberSignupRole\(activeTab === "signup" \? signUpData\.role : "student"\);/);
    expect(fn.indexOf("rememberSignupRole")).toBeLessThan(fn.indexOf("signInWithOAuth"));
  });

  it("діалог змонтований там, де людина опиняється після входу", () => {
    expect(src("src/components/AppLayout.tsx")).toMatch(/<ClaimTutorRoleDialog \/>/);
  });

  it("міграція не пускає нічого зайвого: 24 години, чистий акаунт, без менеджера", () => {
    const m = src("supabase/migrations/20260924120000_claim_tutor_role.sql");
    expect(m).toMatch(/_created < now\(\) - interval '24 hours'/);
    expect(m).toMatch(/RETURN 'has_data';/);
    expect(m).toMatch(/EXISTS \(SELECT 1 FROM public\.student_rates/);
    expect(m).toMatch(/EXISTS \(SELECT 1 FROM public\.lessons/);
    expect(m).toMatch(/set_config\('app\.allow_initial_role', '1', true\)/);
    // гілка прапорця стоїть ПІСЛЯ заборони на роль менеджера
    expect(m.indexOf("Only the platform admin can grant the manager role"))
      .toBeLessThan(m.indexOf("app.allow_initial_role', true) = '1'"));
    expect(m).toMatch(/GRANT {2}EXECUTE ON FUNCTION public\.claim_tutor_role\(\) TO authenticated;/);
    // і сценарій на живій базі існує
    expect(src("scripts/db-replay/scenarios/50-claim-tutor-role.sql")).toMatch(/claim_tutor_role\(\)/);
  });
});
