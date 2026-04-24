import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useSubscriptionRequestCount() {
  const { roles } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!roles.includes("manager")) {
      setCount(0);
      return;
    }
    const load = async () => {
      const { count: c } = await supabase
        .from("subscription_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["new", "in_progress"]);
      setCount(c ?? 0);
    };
    load();
    const channel = supabase
      .channel("subscription_requests_badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscription_requests" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roles]);

  return count;
}
