/**
 * Тест: редірект після логіну залежно від ролі.
 * - student-only → /student-dashboard
 * - tutor       → /dashboard
 * - manager     → /dashboard
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AppRole } from "@/hooks/useAuth";

const mockAuth = vi.hoisted(() => ({
  current: {
    user: null as { id: string } | null,
    roles: [] as AppRole[],
    loading: false,
  },
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

import Index from "@/pages/Index";

function renderIndex() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/dashboard" element={<div>TUTOR_OR_MANAGER_DASHBOARD</div>} />
        <Route path="/student-dashboard" element={<div>STUDENT_DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Редірект після логіну (Index)", () => {
  it("student-only → /student-dashboard", () => {
    mockAuth.current = { user: { id: "u1" }, roles: ["student"], loading: false };
    renderIndex();
    expect(screen.getByText("STUDENT_DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText("TUTOR_OR_MANAGER_DASHBOARD")).not.toBeInTheDocument();
  });

  it("tutor → /dashboard", () => {
    mockAuth.current = { user: { id: "u2" }, roles: ["tutor"], loading: false };
    renderIndex();
    expect(screen.getByText("TUTOR_OR_MANAGER_DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText("STUDENT_DASHBOARD")).not.toBeInTheDocument();
  });

  it("manager → /dashboard", () => {
    mockAuth.current = { user: { id: "u3" }, roles: ["manager"], loading: false };
    renderIndex();
    expect(screen.getByText("TUTOR_OR_MANAGER_DASHBOARD")).toBeInTheDocument();
  });

  it("student + tutor → /dashboard (не student-only)", () => {
    mockAuth.current = { user: { id: "u4" }, roles: ["student", "tutor"], loading: false };
    renderIndex();
    expect(screen.getByText("TUTOR_OR_MANAGER_DASHBOARD")).toBeInTheDocument();
  });
});
