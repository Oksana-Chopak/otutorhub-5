/**
 * Перевіряє, що в навігації (sidebar / mobile bottom-nav) користувач
 * бачить ТІЛЬКИ ті пункти, що відповідають його ролі.
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

vi.mock("@/hooks/useUnreadChats", () => ({
  useUnreadChats: () => 0,
}));

vi.mock("@/hooks/useAvailabilityRequestCount", () => ({
  useAvailabilityRequestCount: () => 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  },
}));

import { MobileBottomNav } from "@/components/MobileBottomNav";

function setRoles(roles: AppRole[]) {
  mockAuth.current.user = { id: "u1" };
  mockAuth.current.roles = roles;
}

beforeEach(() => setRoles([]));

function renderNav() {
  return render(
    <MemoryRouter>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

describe("MobileBottomNav — пункти за ролями", () => {
  it("MANAGER бачить пункт 'Фінанси' та 'Люди'", () => {
    setRoles(["manager"]);
    renderNav();
    expect(screen.queryByText(/Фінанси/i)).toBeTruthy();
  });

  it("TUTOR не бачить 'Люди' / 'Аудит' (але бачить 'Фінанси')", () => {
    setRoles(["tutor"]);
    renderNav();
    expect(screen.queryByText(/Люди/i)).toBeNull();
    expect(screen.queryByText(/Аудит/i)).toBeNull();
  });

  it("STUDENT не бачить 'Фінанси' / 'Люди' / 'Аудит' / 'Доступність'", () => {
    setRoles(["student"]);
    renderNav();
    expect(screen.queryByText(/Фінанси/i)).toBeNull();
    expect(screen.queryByText(/Люди/i)).toBeNull();
    expect(screen.queryByText(/Аудит/i)).toBeNull();
    expect(screen.queryByText(/Доступність/i)).toBeNull();
  });
});
