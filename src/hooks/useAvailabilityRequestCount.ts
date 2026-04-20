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
    const ch = supabase
      .channel("avail-requests-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability_requests" },
        () => fetchCount()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, roles.join(",")]);

  return count;
}
