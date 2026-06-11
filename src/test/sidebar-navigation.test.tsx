/**
 * Перевіряє, що MobileBottomNav показує правильні пункти для кожної ролі.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppRole } from "@/hooks/useAuth";

const mockAuth = vi.hoisted(() => ({
  current: { user: null as any, roles: [] as AppRole[] },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAuth.current.user,
    session: mockAuth.current.user ? { user: mockAuth.current.user } : null,
    roles: mockAuth.current.roles,
    loading: false,
    signOut: vi.fn(),
    refreshRoles: vi.fn(),
    checkRole: (r: AppRole) => mockAuth.current.roles.includes(r),
  }),
}));

vi.mock("@/hooks/useUnreadChats", () => ({ useUnreadChats: () => 0 }));
vi.mock("@/hooks/useAvailabilityRequestCount", () => ({ useAvailabilityRequestCount: () => 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "nav.dashboard": "Головна",
        "nav.schedule": "Розклад",
        "nav.studentsShort": "Учні",
        "nav.students": "Мої учні",
        "nav.finances": "Фінанси",
        "nav.chats": "Чати",
        "nav.people": "Люди",
        "nav.profile": "Профіль",
        "nav.audit": "Аудит",
        "nav.availability": "Доступність",
      };
      return labels[key] ?? key.split(".").pop() ?? key;
    },
    i18n: { language: "uk", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: any) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { MobileBottomNav } from "@/components/MobileBottomNav";

function setRoles(roles: AppRole[]) {
  mockAuth.current.user = { id: "u1" };
  mockAuth.current.roles = roles;
}

beforeEach(() => setRoles([]));

function renderNav() {
  return render(<MemoryRouter><MobileBottomNav /></MemoryRouter>);
}

describe("MobileBottomNav — пункти за ролями", () => {
  it("без ролей — нічого не рендериться", () => {
    setRoles([]);
    mockAuth.current.user = null;
    const { container } = renderNav();
    expect(container.querySelector("nav")).toBeNull();
  });

  // Нав тепер icon-only (без підписів) — перевіряємо за href вкладок.
  const hrefs = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("a")).map((a) => a.getAttribute("href"));

  it("MANAGER бачить вкладку Фінансів (іконка гаманця)", () => {
    setRoles(["manager"]);
    const { container } = renderNav();
    expect(hrefs(container)).toContain("/finances");
    expect(hrefs(container)).not.toContain("/achievements");
  });

  it("TUTOR бачить вкладку Фінансів", () => {
    setRoles(["tutor"]);
    const { container } = renderNav();
    expect(hrefs(container)).toContain("/finances");
  });

  it("STUDENT бачить дзеркало меню StudentLayout (без Фінансів)", () => {
    setRoles(["student"]);
    const { container } = renderNav();
    const h = hrefs(container);
    expect(h).not.toContain("/finances");
    expect(h).toContain("/student-dashboard");
    expect(h).toContain("/student/schedule");
    expect(h).toContain("/chats");
  });
});
