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

  it("MANAGER бачить 'Люди' та 'Фінанси'", () => {
    setRoles(["manager"]);
    renderNav();
    expect(screen.queryByText(/Люди/i)).toBeTruthy();
    expect(screen.queryByText(/Фінанси/i)).toBeTruthy();
    // Manager не бачить "Учні" (це tutor-специфічний пункт)
    expect(screen.queryByText(/^Учні$/i)).toBeNull();
  });

  it("TUTOR бачить 'Учні', 'Фінанси' і НЕ бачить 'Люди'", () => {
    setRoles(["tutor"]);
    renderNav();
    expect(screen.queryByText(/^Учні$/i)).toBeTruthy();
    expect(screen.queryByText(/Фінанси/i)).toBeTruthy();
    expect(screen.queryByText(/Люди/i)).toBeNull();
  });

  it("STUDENT не бачить 'Фінанси' і 'Люди'", () => {
    setRoles(["student"]);
    renderNav();
    expect(screen.queryByText(/Фінанси/i)).toBeNull();
    expect(screen.queryByText(/Люди/i)).toBeNull();
  });
});
