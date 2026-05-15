import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
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
    const mountedRef = useRef(true);

  useEffect(() => {
        mountedRef.current = true;
        return () => {
                mountedRef.current = false;
        };
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        if (mountedRef.current) {
                setRoles((data ?? []).map((r) => r.role as AppRole));
        }
  }, []);

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
                                                    // Retry up to 3 times with exponential backoff
                                        const claimWithRetry = async (attempt = 0): Promise<void> => {
                                                        const { data, error } = await supabase.rpc("claim_referral", { _code: code });
                                                        const reason = (data as any)?.reason;
                                                        if (!error && (data as any)?.ok) {
                                                                          localStorage.removeItem("tutorhub.referralCode");
                                                                          return;
                                                        }
                                                        if (reason === "already_referred" || reason === "self" || reason === "invalid_code") {
                                                                          localStorage.removeItem("tutorhub.referralCode");
                                                                          return;
                                                        }
                                                        if (attempt < 2) {
                                                                          setTimeout(() => claimWithRetry(attempt + 1), 1000 * (attempt + 1));
                                                        } else {
                                                                          console.warn("[referral] claim failed after 3 attempts", error ?? data);
                                                        }
                                        };
                                                    setTimeout(() => claimWithRetry(), 300);
                                      }

                                    // Persist landing-page quiz answers to student_intake_quiz on first sign-in.
                                    const leadRaw = localStorage.getItem("otutorhub_lead_quiz");
                                      if (leadRaw) {
                                                    let lead: unknown;
                                                    try {
                                                                    lead = JSON.parse(leadRaw);
                                                    } catch {
                                                                    // Corrupted data — remove to prevent permanent block
                                                      localStorage.removeItem("otutorhub_lead_quiz");
                                                                    lead = null;
                                                    }
                                                    if (lead && typeof lead === "object") {
                                                                    setTimeout(async () => {
                                                                                      try {
                                                                                                          const typedLead = lead as Record<string, unknown>;
                                                                                                          const { error } = await supabase.from("student_intake_quiz").insert({
                                                                                                                                student_id: newSession.user.id,
                                                                                                                                subjects: Array.isArray(typedLead.subjects) ? typedLead.subjects : [],
                                                                                                                                level: typeof typedLead.level === "string" ? typedLead.level : null,
                                                                                                                                schedule: Array.isArray(typedLead.schedule) ? typedLead.schedule : [],
                                                                                                                                goal: typeof typedLead.goal === "string" ? typedLead.goal : null,
                                                                                                                                goal_other: typeof typedLead.goal_other === "string" ? typedLead.goal_other : null,
                                                                                                            });
                                                                                                          if (!error) localStorage.removeItem("otutorhub_lead_quiz");
                                                                                        } catch (_) { /* ignore network errors */ }
                                                                    }, 800);
                                                    }
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
                const handleUnload = () => {
                        const remember = localStorage.getItem("tutorhub.rememberMe");
                        if (remember === "false") {
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
  }, [fetchRoles]);

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
        </AuthContext.Provider>AuthContext.Provider>
      );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
