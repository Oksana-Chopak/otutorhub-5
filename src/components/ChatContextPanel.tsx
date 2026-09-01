import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { uk as ukLocale, enUS, sv as svLocale } from "date-fns/locale";
import { X, Copy, Phone } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ChatContextPanelProps {
  tutorId: string | null;
  studentId: string | null;
  className?: string;
  onClose?: () => void;
  /** Student-payment / debt context is shown ONLY to the party actually owed:
   *  the manager (hub receivable) or the independent tutor of record. A hub tutor
   *  must never see what the student owes the hub. */
  viewerIsManager?: boolean;
  viewerId?: string | null;
}

interface NextLesson {
  id: string;
  starts_at: string;
  subject: string | null;
  duration_minutes: number | null;
  student_payment_status: string | null;
}

interface LastHomework {
  id: string;
  starts_at: string;
  subject: string | null;
  homework: string;
}

const localeMap: Record<string, typeof ukLocale> = { uk: ukLocale, en: enUS, sv: svLocale };

export function ChatContextPanel({ tutorId, studentId, className, onClose, viewerIsManager, viewerId }: ChatContextPanelProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = localeMap[i18n.language] ?? ukLocale;
  const [loading, setLoading] = useState(false);
  const [nextLesson, setNextLesson] = useState<NextLesson | null>(null);
  const [lastHomework, setLastHomework] = useState<LastHomework | null>(null);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [rateSource, setRateSource] = useState<string | null>(null);
  const [contact, setContact] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);

  useEffect(() => {
    if (!tutorId || !studentId) {
      setNextLesson(null);
      setLastHomework(null);
      setUnpaidCount(0);
      setRateSource(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Контакти учня (email + телефон) — щоб репетитор міг їх глянути з чату.
      const [{ data: prof }, { data: cont }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name").eq("id", studentId).maybeSingle(),
        supabase.from("profile_contacts").select("email, phone").eq("user_id", studentId).maybeSingle(),
      ]);
      if (!cancelled) {
        setContact({
          name: prof ? `${prof.first_name ?? ""} ${prof.last_name ?? ""}`.trim() : "",
          email: (cont as any)?.email ?? null,
          phone: (cont as any)?.phone ?? null,
        });
      }
      const nowIso = new Date().toISOString();
      const [nextRes, hwRes, unpaidRes, srcRes] = await Promise.all([
        // student_payment_status via the masked lessons_visible view (GRANT-locked on
        // lesson_details): NULL for a hub tutor, so student→hub payment context stays
        // hidden from them at the DB level too.
        supabase
          .from("lessons_visible")
          .select("id, starts_at, subject, duration_minutes, student_payment_status")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .gte("starts_at", nowIso)
          .eq("status", "scheduled")
          .order("starts_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("lessons")
          .select("id, starts_at, subject, lesson_details!inner(homework)")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .eq("status", "completed")
          .not("lesson_details.homework", "is", null)
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("lessons_visible")
          .select("id", { count: "exact", head: true })
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .eq("status", "completed")
          .eq("student_payment_status", "unpaid"),
        supabase
          .from("student_rates")
          .select("source")
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (nextRes.data) {
        setNextLesson({
          id: nextRes.data.id,
          starts_at: nextRes.data.starts_at,
          subject: nextRes.data.subject,
          duration_minutes: nextRes.data.duration_minutes,
          student_payment_status: (nextRes.data as any).student_payment_status ?? null,
        });
      } else {
        setNextLesson(null);
      }

      if (hwRes.data) {
        const d = Array.isArray(hwRes.data.lesson_details)
          ? hwRes.data.lesson_details[0]
          : hwRes.data.lesson_details;
        if (d?.homework) {
          setLastHomework({
            id: hwRes.data.id,
            starts_at: hwRes.data.starts_at,
            subject: hwRes.data.subject,
            homework: d.homework,
          });
        } else {
          setLastHomework(null);
        }
      } else {
        setLastHomework(null);
      }

      setUnpaidCount(unpaidRes.count ?? 0);
      // Fail CLOSED: if there's no student_rates row (source unknown), treat the pair
      // as "hub" so student→hub payment context stays hidden from a hub tutor. A null
      // fallback here would open payments whenever the rates row is missing.
      setRateSource((srcRes.data as any)?.source ?? "hub");
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tutorId, studentId]);

  // Only the party actually owed sees student-payment status: the manager (hub
  // receivable) or the independent tutor of record. A hub tutor (rateSource ===
  // "hub") never sees what the student owes the hub.
  const canSeePayments =
    !!viewerIsManager || (viewerId != null && viewerId === tutorId && rateSource !== "hub");

  return (
    <div className={cn("flex flex-col gap-4 border-l border-border bg-muted/30 p-4 overflow-y-auto", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("chatContext.title")}</h3>
        {onClose && (
          <Button variant="ghost" size="icon" className="tap-44 h-7 w-7" onClick={onClose} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-[16px]" />
          <Skeleton className="h-16 w-full rounded-[16px]" />
        </div>
      ) : (
        <>
          {/* Контакти учня */}
          {contact && (contact.email || contact.phone) && (
            <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--ds-border,#eceef3)", background: "var(--ds-surface,#fff)" }}>
              {contact.email && (
                <div className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderBottom: contact.phone ? "1px solid #f3f4f8" : "none" }}>
                  <span style={{ color: "var(--sub,#666b82)", flexShrink: 0 }}>📧</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] uppercase tracking-wide" style={{ color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui" }}>Email</p>
                    <p className="text-[14px] truncate" style={{ color: "var(--ds-txt,#0f0f1a)" }}>{contact.email}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(contact.email!); toast.success(t("chatContextPanel.emailCopied"), { description: contact.email! }); }}
                    className="p-1.5 rounded-full hover:bg-muted flex-shrink-0" style={{ color: "var(--sub,#666b82)" }} title={t("chatContextPanel.copy")}>
                    <Copy size={19} strokeWidth={2} />
                  </button>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span style={{ color: "var(--sub,#666b82)", flexShrink: 0 }}>📞</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] uppercase tracking-wide" style={{ color: "var(--sub,#666b82)", fontFamily: "Inter, system-ui" }}>{t("chatContextPanel.phone")}</p>
                    <p className="text-[14px] truncate" style={{ color: "var(--ds-txt,#0f0f1a)" }}>{contact.phone}</p>
                  </div>
                  <a href={`tel:${contact.phone}`} className="p-1.5 rounded-full hover:bg-muted flex-shrink-0" style={{ color: "#1f8e7e" }} title={t("chatContextPanel.call")}>
                    <Phone size={15} />
                  </a>
                  <button onClick={() => { navigator.clipboard.writeText(contact.phone!); toast.success(t("chatContextPanel.phoneCopied"), { description: contact.phone! }); }}
                    className="p-1.5 rounded-full hover:bg-muted flex-shrink-0" style={{ color: "var(--sub,#666b82)" }} title={t("chatContextPanel.copy")}>
                    <Copy size={19} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-[16px] border border-border bg-card overflow-hidden">
            <p className="px-3 pt-3 pb-1.5 text-[14px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("chatContext.nextLesson")}
            </p>
            {nextLesson ? (
              <Link
                to={`/schedule?lesson=${nextLesson.id}`}
                className="block px-3 pb-3 hover:bg-muted/40 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">
                  {format(new Date(nextLesson.starts_at), "d MMM, HH:mm", { locale: dateLocale })}
                </p>
                {nextLesson.subject && (
                  <p className="text-[14px] text-muted-foreground">{nextLesson.subject}</p>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  {canSeePayments && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[14px] font-semibold",
                        nextLesson.student_payment_status === "paid"
                          ? "border-transparent bg-success/15 text-success"
                          : "border-transparent bg-warning/15 text-warning"
                      )}
                    >
                      {nextLesson.student_payment_status === "paid"
                        ? t("chatContext.paid")
                        : t("chatContext.unpaid")}
                    </span>
                  )}
                  <span className="text-[14px] text-muted-foreground ml-auto">
                    {t("chatContextPanel.openLesson")}
                  </span>
                </div>
              </Link>
            ) : (
              <p className="px-3 pb-3 text-[14px] text-muted-foreground">{t("chatContext.noUpcoming")}</p>
            )}
          </div>

          {canSeePayments && unpaidCount > 0 && (
            <div className="rounded-[16px] border border-warning/40 bg-warning/8 p-3">
              <p className="mb-1 text-[14px] font-medium uppercase tracking-wide text-warning">
                {t("chatContext.debt")}
              </p>
              <p className="text-sm font-semibold text-foreground">
                {t("chatContext.debtLessons", { count: unpaidCount })}
              </p>
              <Link
                to="/finances?filter=need_pay"
                className="mt-1.5 inline-block text-[14px] text-primary underline underline-offset-2"
              >
                {t("chatContext.viewDebts")}
              </Link>
            </div>
          )}

          {lastHomework && (
            <Link
              to={`/schedule?lesson=${lastHomework.id}`}
              className="block rounded-[16px] border border-border bg-card p-3 hover:bg-muted/40 transition-colors"
            >
              <p className="mb-1.5 text-[14px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("chatContext.lastHomework")}
              </p>
              <p className="text-[14px] text-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                {lastHomework.homework}
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground flex items-center justify-between">
                <span>
                  {format(new Date(lastHomework.starts_at), "d MMM", { locale: dateLocale })}
                  {lastHomework.subject && ` · ${lastHomework.subject}`}
                </span>
                <span>{t("chatContextPanel.goTo")}</span>
              </p>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
