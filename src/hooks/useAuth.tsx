import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { onSessionExpired, reportSessionExpired, resetSessionExpiry, isTransientAuthError, RESTORE_DELAYS_MS } from "@/integrations/supabase/sessionExpiry";
import { toast } from "sonner";
import i18n from "@/i18n";

export type AppRole = "manager" | "tutor" | "student";

/** Паузи між спробами прочитати ролі (26.09): швидко, потім терплячіше. */
const ROLE_RETRY_DELAYS_MS: readonly number[] = [600, 1_800, 4_000];

interface AuthContextValue {
    user: User | null;
    session: Session | null;
    roles: AppRole[];
    loading: boolean;
    /** Ролі не прочитались після всіх спроб (не «їх немає»). */
    rolesUnreadable: boolean;
    signOut: () => Promise<void>;
    refreshRoles: () => Promise<void>;
    checkRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [roles, setRoles] = useState<AppRole[]>([]);
    // Читання ролей не вдалося навіть після ретраїв: стан «ролей немає» тут
    // означає «не змогли прочитати», і сторінка мусить сказати це словами.
    const [rolesUnreadable, setRolesUnreadable] = useState(false);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);
    // 23.09: останні живі токени — щоб після SIGNED_OUT, якого ми не просили
    // (supabase-js стер сесію після 429 на оновленні), тихо спробувати повернути
    // сесію, а не виганяти людину на вхід через тимчасовий ліміт.
    const lastTokensRef = useRef<{ access_token: string; refresh_token: string } | null>(null);
    const explicitSignOutRef = useRef(false);
    const restoringRef = useRef(false);

  useEffect(() => {
        mountedRef.current = true;
        return () => {
                mountedRef.current = false;
        };
  }, []);

  /**
   * Ролі — це дозвіл на вхід у застосунок: поки їх немає, Index тримає напис
   * «роль ще не призначена», а ProtectedRoute відкидає людину з її ж сторінки.
   *
   * B10: збій ЧИТАННЯ ролей — не те саме, що «ролей немає», тож попередні ролі
   * зберігаємо. Але на ХОЛОДНОМУ старті попередніх немає: один невдалий запит
   * (429 на IP оператора, мережа) назавжди лишав людину на спінері — саме так
   * 26.09 робот-сторож не зміг увійти учнем за 45 секунд. Тому читання роблять
   * до трьох разів із бекофом, і лише потім здається — тихо, зі збереженням
   * попереднього стану (у нього є названий вихід із кнопкою «Спробувати ще»).
   */
  const fetchRoles = useCallback(async (userId: string, attempt = 0): Promise<void> => {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        if (!mountedRef.current) return;
        if (error) {
                if (attempt < ROLE_RETRY_DELAYS_MS.length) {
                        const wait = ROLE_RETRY_DELAYS_MS[attempt];
                        console.warn(`[auth] roles read failed — retry in ${wait}ms`, error);
                        setTimeout(() => { if (mountedRef.current) void fetchRoles(userId, attempt + 1); }, wait);
                        return;
                }
                console.warn("[auth] roles read failed — keeping previous roles", error);
                setRolesUnreadable(true);
                return;
        }
        setRolesUnreadable(false);
        setRoles((data ?? []).map((r) => r.role as AppRole));
  }, []);

  useEffect(() => {
        // Set up listener FIRST
                const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
                        if (newSession?.refresh_token) {
                                lastTokensRef.current = { access_token: newSession.access_token, refresh_token: newSession.refresh_token };
                        }
                        // Поки триває спроба відновлення, SIGNED_OUT — це відлуння самої спроби
                        // (supabase-js знову стер сесію після 429): стан не чіпаємо.
                        if (event === "SIGNED_OUT" && restoringRef.current) return;
                        if (event === "SIGNED_OUT" && !explicitSignOutRef.current && lastTokensRef.current) {
                                // SIGNED_OUT без нашого signOut = supabase-js стер сесію після
                                // невдалого оновлення (429 «забагато запитів» — тимчасово). Стан
                                // не чистимо одразу: одна-дві тихі спроби повернути сесію тим самим
                                // refresh-токеном; не вийшло — тоді вхід заново (state.from поверне
                                // людину туди, де вона була).
                                restoringRef.current = true;
                                const tokens = lastTokensRef.current;
                                const attempt = async (i: number) => {
                                        let dead = false;
                                        try {
                                                const { data, error } = await supabase.auth.setSession(tokens);
                                                if (!error && data.session) { restoringRef.current = false; return; } // SIGNED_IN прийде сам
                                                if (error && !isTransientAuthError(error)) dead = true;               // токен мертвий — не мучимо
                                        } catch { /* мережа — рахуємо як тимчасове */ }
                                        if (!dead && i + 1 < RESTORE_DELAYS_MS.length) { setTimeout(() => void attempt(i + 1), RESTORE_DELAYS_MS[i + 1]); return; }
                                        restoringRef.current = false;
                                        lastTokensRef.current = null;
                                        if (!mountedRef.current) return;
                                        setSession(null); setUser(null); setRoles([]);
                                        toast.error(i18n.t("auth.sessionExpired"), { description: i18n.t("auth.sessionExpiredDesc") });
                                };
                                setTimeout(() => void attempt(0), RESTORE_DELAYS_MS[0]);
                                return;
                        }
                        if (event === "SIGNED_OUT") { lastTokensRef.current = null; explicitSignOutRef.current = false; }
                        setSession(newSession);
                        setUser(newSession?.user ?? null);
                        if (newSession?.user) {
                                  // Defer Supabase calls to avoid deadlock
                          setTimeout(() => fetchRoles(newSession.user.id), 0);
                                  // Claim pending referral code (set by /join/:code page) on first sign-in after signup
                          if (event === "SIGNED_IN") {
                                      // Успішний вхід — наступний збій має прозвучати знову.
                                      resetSessionExpiry();
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
                }).catch((e) => {
                        // B10: без catch відхилений проміс лишав loading=true назавжди —
                        // застосунок застигав на скелетоні до перезавантаження.
                        console.warn("[auth] getSession failed", e);
                        if (mountedRef.current) setLoading(false);
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

  // ── Протухла сесія (16.09, скан живих логів) ──────────────────────────────
  // «Розклад і профіль репетитора відповідають permission denied рівно в ті
  // моменти, коли оновлення токена впирається в ліміт». Це протухла сесія:
  // браузер далі ходить у базу зі старим токеном, а сторінка малює ПОРОЖНЮ —
  // людина бачить не «увійдіть ще раз», а зниклі уроки. Тепер сигнал із
  // обгортки fetch чистить стан, і ProtectedRoute веде на вхід, звідки
  // людина повертається туди ж, де була (state.from).
  useEffect(() => {
        return onSessionExpired(() => {
                if (!mountedRef.current) return;
                setUser(null);
                setSession(null);
                setRoles([]);
                // Вихід ЛОКАЛЬНИЙ: мережа зараз може бути під лімітом, а мертвий
                // токен у сховищі — саме те, через що наступний запит знову впаде.
                explicitSignOutRef.current = true;
                lastTokensRef.current = null;
                void supabase.auth.signOut({ scope: "local" }).catch(() => { /* ігноруємо */ });
                toast.error(i18n.t("auth.sessionExpired"), { description: i18n.t("auth.sessionExpiredDesc") });
        });
  }, []);

  // Не чекаємо першого зламаного екрана: щойно вкладку повернули з фону (або
  // раз на 5 хв), питаємо, чи токен ще живий, і мовчки поновлюємо. Не вдалось
  // поновити — це той самий сигнал, тільки без порожньої сторінки перед ним.
  useEffect(() => {
        const check = async () => {
                if (typeof document === "undefined" || document.visibilityState !== "visible") return;
                const { data } = await supabase.auth.getSession();
                const s = data.session;
                if (!s) return;
                const expMs = (s.expires_at ?? 0) * 1000;
                if (!expMs || expMs - Date.now() > 60_000) return;
                const { error } = await supabase.auth.refreshSession();
                // 23.09: ліміт/мережа — тимчасово, наступний тик спробує ще; сигнал
                // «сесія протухла» — лише коли сервер справді відкинув токен.
                if (error && !isTransientAuthError(error)) reportSessionExpired();
        };
        const onVis = () => { void check(); };
        document.addEventListener("visibilitychange", onVis);
        const id = window.setInterval(onVis, 5 * 60_000);
        return () => {
                document.removeEventListener("visibilitychange", onVis);
                window.clearInterval(id);
        };
  }, []);

  const signOut = async () => {
        explicitSignOutRef.current = true;
        lastTokensRef.current = null;
        await supabase.auth.signOut();
  };

  const refreshRoles = async () => {
        if (user) await fetchRoles(user.id);
  };

  const checkRole = (role: AppRole) => roles.includes(role);

  return (
        <AuthContext.Provider value={{ user, session, roles, loading, rolesUnreadable, signOut, refreshRoles, checkRole }}>
          {children}
        </AuthContext.Provider>
      );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
