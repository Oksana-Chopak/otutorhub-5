import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "manager" | "tutor" | "student";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  checkRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    setRoles((data ?? []).map((r) => r.role as AppRole));
  };

  useEffect(() => {
    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // Defer Supabase calls to avoid deadlock
        setTimeout(() => fetchRoles(newSession.user.id), 0);
        // Claim pending referral code (set by /join/:code page) on first sign-in after signup
        if (event === "SIGNED_IN") {
          const code = localStorage.getItem("tutorhub.referralCode");
          if (code) {
            setTimeout(() => {
              supabase.rpc("claim_referral", { _code: code }).then(({ data, error }) => {
                if (!error && (data as any)?.ok) {
                  localStorage.removeItem("tutorhub.referralCode");
                } else if ((data as any)?.reason === "already_referred" || (data as any)?.reason === "self") {
                  localStorage.removeItem("tutorhub.referralCode");
                }
              });
            }, 500);
          }
        }
      } else {
        setRoles([]);
      }
    });

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        fetchRoles(existing.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // "Remember me": if user opted out, clear the persisted Supabase token on tab close
    // so next visit forces a fresh login.
    const handleUnload = () => {
      const remember = localStorage.getItem("tutorhub.rememberMe");
      if (remember === "false") {
        // Remove all sb-* auth keys from localStorage
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
            localStorage.removeItem(k);
          }
        });
      }
    };
    window.addEventListener("pagehide", handleUnload);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("pagehide", handleUnload);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshRoles = async () => {
    if (user) await fetchRoles(user.id);
  };

  const checkRole = (role: AppRole) => roles.includes(role);

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, signOut, refreshRoles, checkRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
