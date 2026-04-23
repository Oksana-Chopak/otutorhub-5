import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns the count of open availability requests visible to the current user:
 * - manager: all open requests
 * - tutor: requests addressed to them
 * - student: their own open requests still pending
 * - none: 0
 */
export function useAvailabilityRequestCount(): number {
  const { user, roles } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    const isManager = roles.includes("manager");
    const isTutor = roles.includes("tutor");

    const fetchCount = async () => {
      let query = supabase
        .from("availability_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (!isManager) {
        if (isTutor) {
          query = query.eq("tutor_id", user.id);
        } else {
          query = query.eq("requester_id", user.id);
        }
      }
      const { count: c } = await query;
      setCount(c ?? 0);
    };

    fetchCount();
    // Scope realtime subscription to rows the user can actually see.
    // Managers see all; tutors see rows where they are tutor_id; others see rows
    // where they are requester_id. This is defense-in-depth on top of table RLS,
    // which already filters payloads.
    const filter = isManager
      ? undefined
      : isTutor
        ? `tutor_id=eq.${user.id}`
        : `requester_id=eq.${user.id}`;
    const ch = supabase
      .channel(`avail-requests-count:${user.id}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability_requests", ...(filter ? { filter } : {}) },
        () => fetchCount()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, roles.join(",")]);

  return count;
}
