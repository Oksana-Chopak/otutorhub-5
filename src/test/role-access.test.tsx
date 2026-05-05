/**
 * Тести доступу до сторінок за ролями.
 * Перевіряє, що ProtectedRoute коректно пропускає / редіректить
 * користувачів залежно від їхньої ролі (manager / tutor / student / гість).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import type { AppRole } from "@/hooks/useAuth";

// Мок useAuth — повертаємо різні ролі/стани в кожному тесті.
const mockAuth = vi.hoisted(() => ({
  current: {
    user: null as { id: string } | null,
    roles: [] as AppRole[],
    loading: false,
  },
}));

vi.mock("@/hooks/useAuth", async () => {
  return {
    useAuth: () => ({
      user: mockAuth.current.user,
      session: mockAuth.current.user ? { user: mockAuth.current.user } : null,
      roles: mockAuth.current.roles,
      loading: mockAuth.current.loading,
      signOut: vi.fn(),
      refreshRoles: vi.fn(),
      checkRole: (r: AppRole) => mockAuth.current.roles.includes(r),
    }),
  };
});

function setAuth(roles: AppRole[], opts?: { loading?: boolean; loggedIn?: boolean }) {
  const loggedIn = opts?.loggedIn ?? roles.length > 0;
  mockAuth.current.user = loggedIn ? { id: "user-1" } : null;
  mockAuth.current.roles = roles;
  mockAuth.current.loading = opts?.loading ?? false;
}

function renderRoute(allowedRoles: AppRole[] | undefined, initialPath = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/auth" element={<div>AUTH_PAGE</div>} />
        <Route path="/" element={<div>HOME_PAGE</div>} />
        <Route path="/student-dashboard" element={<div>STUDENT_DASHBOARD</div>} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute allowedRoles={allowedRoles}>
              <div>PROTECTED_CONTENT</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setAuth([], { loggedIn: false });
});

describe("ProtectedRoute — гість (неавторизований)", () => {
  it("редіректить на /auth при доступі до будь-якої захищеної сторінки", () => {
    setAuth([], { loggedIn: false });
    renderRoute(undefined);
    expect(screen.getByText("AUTH_PAGE")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED_CONTENT")).not.toBeInTheDocument();
  });

  it("редіректить на /auth навіть для роль-обмежених сторінок", () => {
    setAuth([], { loggedIn: false });
    renderRoute(["manager"]);
    expect(screen.getByText("AUTH_PAGE")).toBeInTheDocument();
  });
});

describe("ProtectedRoute — стан завантаження", () => {
  it("показує лоадер, поки auth ще завантажується", () => {
    setAuth([], { loading: true, loggedIn: false });
    const { container } = renderRoute(undefined);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByText("PROTECTED_CONTENT")).not.toBeInTheDocument();
  });
});

describe("Доступ для ролі MANAGER", () => {
  beforeEach(() => setAuth(["manager"]));

  it.each([
    ["/ (Dashboard)", undefined],
    ["/schedule", undefined],
    ["/chats", undefined],
    ["/finances", ["manager", "tutor"] as AppRole[]],
    ["/people", ["manager"] as AppRole[]],
    ["/audit", ["manager"] as AppRole[]],
    ["/availability", ["manager", "tutor"] as AppRole[]],
  ])("має доступ до %s", (_label, allowedRoles) => {
    renderRoute(allowedRoles);
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument();
  });
});

describe("Доступ для ролі TUTOR", () => {
  beforeEach(() => setAuth(["tutor"]));

  it.each([
    ["/ (Dashboard)", undefined],
    ["/schedule", undefined],
    ["/chats", undefined],
    ["/availability", ["manager", "tutor"] as AppRole[]],
    ["/finances", ["manager", "tutor"] as AppRole[]],
  ])("має доступ до %s", (_label, allowedRoles) => {
    renderRoute(allowedRoles);
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument();
  });

  it.each([
    ["/people", ["manager"] as AppRole[]],
    ["/audit", ["manager"] as AppRole[]],
  ])("НЕ має доступу до %s — редіректить на /", (_label, allowedRoles) => {
    renderRoute(allowedRoles);
    expect(screen.getByText("HOME_PAGE")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED_CONTENT")).not.toBeInTheDocument();
  });
});

describe("Доступ для ролі STUDENT", () => {
  beforeEach(() => setAuth(["student"]));

  it.each([
    ["/ (Dashboard)", undefined],
    ["/schedule", undefined],
    ["/chats", undefined],
  ])("має доступ до %s", (_label, allowedRoles) => {
    renderRoute(allowedRoles);
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument();
  });

  it.each([
    ["/finances", ["manager", "tutor"] as AppRole[]],
    ["/people", ["manager"] as AppRole[]],
    ["/audit", ["manager"] as AppRole[]],
    ["/availability", ["manager", "tutor"] as AppRole[]],
  ])("НЕ має доступу до %s — редіректить на /student-dashboard", (_label, allowedRoles) => {
    renderRoute(allowedRoles);
    expect(screen.getByText("STUDENT_DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED_CONTENT")).not.toBeInTheDocument();
  });
});

describe("Підтримка кількох ролей одночасно", () => {
  it("користувач з manager+tutor має доступ до сторінок обох ролей", () => {
    setAuth(["manager", "tutor"]);
    renderRoute(["manager"]);
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument();
  });

  it("якщо хоч одна роль збігається з allowedRoles — пропускає", () => {
    setAuth(["tutor"]);
    renderRoute(["manager", "tutor"]);
    expect(screen.getByText("PROTECTED_CONTENT")).toBeInTheDocument();
  });
});
