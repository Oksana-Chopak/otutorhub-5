import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { bumpDataVersion } from "@/lib/dataBus";

/**
 * «Школа X запрошує вас» — згода учня з акаунтом на вступ до школи (11.11).
 *
 * Менеджер школи не може сам додати людину, яка вже має акаунт: членство відкриває
 * школі її імʼя, контакти й уроки, тож рішення — за самою людиною. Менеджер
 * надсилає запрошення (`hub_invite_existing_student`), а тут вона його бачить і
 * приймає чи відхиляє. Поки функцій у базі немає (чи запрошень немає) — картки
 * немає; збій читання не показує нічого, а не порожню рамку.
 */
type Invite = { id: string; hub_name: string };

export function SchoolInviteCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (supabase.rpc as any)("my_hub_invites").then(({ data, error }: { data: Invite[] | null; error: unknown }) => {
      if (alive && !error) setInvites(data ?? []);
    });
    return () => { alive = false; };
  }, [user?.id]);

  const resolve = async (inv: Invite, accept: boolean) => {
    if (busy) return;
    setBusy(inv.id);
    try {
      const { data, error } = await (supabase.rpc as any)("resolve_hub_invite", { _id: inv.id, _accept: accept });
      if (error || (data !== "accepted" && data !== "declined")) { toast.error(t("schoolInvite.failed")); return; }
      setInvites((list) => list.filter((x) => x.id !== inv.id));
      if (accept) {
        haptic.success();
        toast.success(t("schoolInvite.joined", { name: inv.hub_name }));
        bumpDataVersion();
      }
    } finally {
      setBusy(null);
    }
  };

  if (invites.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      {invites.map((inv) => (
        <section key={inv.id} aria-label={t("schoolInvite.title", { name: inv.hub_name })}
          className="rounded-[16px] border-[0.5px] border-[var(--border)] bg-card p-4">
          <h2 className="text-[17px] font-extrabold text-foreground">🏫 {t("schoolInvite.title", { name: inv.hub_name })}</h2>
          <p className="mt-1 text-[14px] text-muted-foreground" style={{ lineHeight: 1.4 }}>{t("schoolInvite.desc")}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy === inv.id} onClick={() => void resolve(inv, true)}
              className="h-11 flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-60"
              style={{ background: "var(--teal)", color: "#0f0f1a" }}>
              {t("schoolInvite.accept")}
            </button>
            <button type="button" disabled={busy === inv.id} onClick={() => void resolve(inv, false)}
              className="h-11 rounded-[12px] border border-border bg-card px-4 text-[15px] font-semibold text-muted-foreground disabled:opacity-60">
              {t("schoolInvite.decline")}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
