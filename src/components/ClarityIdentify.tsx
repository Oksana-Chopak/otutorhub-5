import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

/**
 * Sends user role + id to Microsoft Clarity once auth is ready,
 * so sessions can be filtered by role (manager / tutor / student).
 */
export function ClarityIdentify() {
  const { user, roles } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined" || !window.clarity) return;
    if (!user) return;
    const role = roles[0] ?? "guest";
    try {
      window.clarity("identify", user.id);
      window.clarity("set", "role", role);
      if (roles.length > 1) window.clarity("set", "roles", roles.join(","));
    } catch {
      // ignore
    }
  }, [user?.id, roles.join(",")]);

  return null;
}
