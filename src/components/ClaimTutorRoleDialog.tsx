import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BookOpenCheck, GraduationCap, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { supportFallbackUrl } from "@/lib/support";

/** Намір, збережений ДО переходу в Google: «я реєструвався як репетитор». */
export const SIGNUP_ROLE_KEY = "oth.signupRole";

export function rememberSignupRole(role: "tutor" | "student"): void {
  try { localStorage.setItem(SIGNUP_ROLE_KEY, role); } catch { /* приватний режим */ }
}
function forgetSignupRole(): void {
  try { localStorage.removeItem(SIGNUP_ROLE_KEY); } catch { /* ignore */ }
}

/**
 * 24.09 (аудит шляхів). Вхід через Google не може передати роль: у метадані
 * OAuth пише провайдер, тож база ставить «учень» за замовчуванням — і репетитор,
 * який щойно прийшов із лендінгу, опинявся в учнівському застосунку без дороги
 * назад. Тепер, якщо людина натискала «Реєстрація» як репетитор, застосунок
 * питає про це прямо і ставить роль через `claim_tutor_role()` (лише свіжий
 * акаунт без учнівських даних — решту база не пускає).
 */
export function ClaimTutorRoleDialog() {
  const { t } = useTranslation();
  const { user, roles, refreshRoles } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || roles.length === 0) return;
    let wanted: string | null = null;
    try { wanted = localStorage.getItem(SIGNUP_ROLE_KEY); } catch { /* ignore */ }
    if (wanted !== "tutor") return;
    if (roles.includes("tutor") || roles.includes("manager")) { forgetSignupRole(); return; }
    if (!roles.includes("student")) return;
    setOpen(true);
  }, [user?.id, roles.join("|")]);

  const claim = async () => {
    setBusy(true);
    let data: string | null = null;
    let error: { message: string } | null = null;
    try {
      const res = await (supabase.rpc as any)("claim_tutor_role");
      data = res.data ?? null;
      error = res.error ?? null;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    } finally {
      setBusy(false);
    }
    if (error) {
      toast.error(t("claimRole.failed"), { description: error.message });
      return;
    }
    if (data === "ok") {
      forgetSignupRole();
      setOpen(false);
      await refreshRoles();
      toast.success(t("claimRole.done"));
      navigate("/onboarding");
      return;
    }
    // База відмовила свідомо (акаунт старший за добу або вже має учнівські дані) —
    // кажемо це словами і даємо живий контакт, а не мовчазний тупик.
    forgetSignupRole();
    setOpen(false);
    toast.error(t("claimRole.refused"), {
      description: t("claimRole.refusedHint"),
      action: { label: t("claimRole.writeSupport"), onClick: () => window.open(supportFallbackUrl("oTutorHub"), "_blank", "noopener") },
      duration: 12000,
    });
  };

  const stayStudent = () => { forgetSignupRole(); setOpen(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stayStudent(); }}>
      <DialogContent aria-describedby={undefined} className="w-full max-w-sm p-5 rounded-t-[20px] rounded-b-none sm:rounded-[20px] bottom-0 top-auto translate-y-0 sm:translate-y-[-50%] sm:top-[50%] sm:bottom-auto">
        <DialogTitle className="text-[19px] font-extrabold">{t("claimRole.title")}</DialogTitle>
        <p className="text-[15px] text-muted-foreground" style={{ lineHeight: 1.45 }}>{t("claimRole.desc")}</p>
        <div className="mt-2 grid gap-2">
          <button
            type="button"
            onClick={claim}
            disabled={busy}
            className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-bold"
            style={{ background: "linear-gradient(135deg,#2BBFAA,#25a896)", color: "#0f0f1a", border: "none", cursor: "pointer" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpenCheck className="h-4 w-4" />}
            {t("claimRole.iAmTutor")}
          </button>
          <button
            type="button"
            onClick={stayStudent}
            disabled={busy}
            className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[15.5px] font-bold text-foreground"
            style={{ cursor: "pointer" }}
          >
            <GraduationCap className="h-4 w-4" />
            {t("claimRole.iAmStudent")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
