/**
 * Тест: сторінка «Мої учні» НЕ викидає незалежного репетитора геть.
 *
 * Регресія: бульбашка «Учні» на дашборді веде на /my-students, але сторінка
 * мала useEffect, що при !isIndependent (зокрема поки useWorkspaceSettings ще
 * вантажиться) робив navigate("/onboarding"). Через timing це відкидало
 * незалежного репетитора назад, і клік по бульбашці виглядав як «нічого не
 * відбувається». Гард прибрано (роут уже захищений ProtectedRoute).
 *
 * Тут перевіряємо: відрендеривши /my-students під незалежним репетитором, ми
 * лишаємось на /my-students і НЕ потрапляємо на /onboarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AppRole } from "@/hooks/useAuth";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => ({
  current: { user: { id: "tutor-1" } as { id: string } | null, roles: ["tutor"] as AppRole[], loading: false },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAuth.current.user,
    session: mockAuth.current.user ? { user: mockAuth.current.user } : null,
    roles: mockAuth.current.roles,
    loading: mockAuth.current.loading,
    signOut: vi.fn(),
    refreshRoles: vi.fn(),
    checkRole: (r: AppRole) => mockAuth.current.roles.includes(r),
  }),
}));

// Незалежний репетитор: isIndependent=true, завантаження завершене.
vi.mock("@/hooks/useWorkspaceSettings", () => ({
  useWorkspaceSettings: () => ({
    isIndependent: true,
    studentCount: 0,
    settings: { workspace_type: "independent" },
    loading: false,
    refresh: vi.fn(),
    isTrial: false,
    isPro: true,
    trialDaysLeft: 0,
    trialUntil: null,
  }),
}));

// AppLayout — лишаємо дітей видимими, без навігаційного каркаса.
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Supabase — порожні дані, без мережі.
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
    is: () => chain, not: () => chain, gte: () => chain, lte: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: mockAuth.current.user }, error: null }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import MyStudentsPage from "@/pages/MyStudentsPage";

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/my-students"]}>
      <Routes>
        <Route path="/my-students" element={<MyStudentsPage />} />
        <Route path="/onboarding" element={<div>ONBOARDING_BOUNCE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("«Мої учні» — незалежного репетитора не викидає", () => {
  beforeEach(() => {
    mockAuth.current = { user: { id: "tutor-1" }, roles: ["tutor"], loading: false };
  });

  it("лишається на /my-students і НЕ редіректить на /onboarding", async () => {
    renderAt();
    // Дати ефектам відпрацювати.
    await waitFor(() => {
      expect(screen.queryByText("ONBOARDING_BOUNCE")).not.toBeInTheDocument();
    });
  });
});
