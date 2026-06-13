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

export function ChatContextPanel({ tutorId, studentId, className, onClose }: ChatContextPanelProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = localeMap[i18n.language] ?? ukLocale;
  const [loading, setLoading] = useState(false);
  const [nextLesson, setNextLesson] = useState<NextLesson | null>(null);
  const [lastHomework, setLastHomework] = useState<LastHomework | null>(null);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [contact, setContact] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);

  useEffect(() => {
    if (!tutorId || !studentId) {
      setNextLesson(null);
      setLastHomework(null);
      setUnpaidCount(0);
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
      const [nextRes, hwRes, unpaidRes] = await Promise.all([
        supabase
          .from("lessons")
          .select("id, starts_at, subject, duration_minutes, lesson_details(student_payment_status)")
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
          .from("lessons")
          .select("id, lesson_details!inner(student_payment_status)", { count: "exact", head: true })
          .eq("tutor_id", tutorId)
          .eq("student_id", studentId)
          .eq("status", "completed")
          .eq("lesson_details.student_payment_status", "unpaid"),
      ]);

      if (cancelled) return;

      if (nextRes.data) {
        const d = Array.isArray(nextRes.data.lesson_details)
          ? nextRes.data.lesson_details[0]
          : nextRes.data.lesson_details;
        setNextLesson({
          id: nextRes.data.id,
          starts_at: nextRes.data.starts_at,
          subject: nextRes.data.subject,
          duration_minutes: nextRes.data.duration_minutes,
          student_payment_status: d?.student_payment_status ?? null,
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
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tutorId, studentId]);

  return (
    <div className={cn("flex flex-col gap-4 border-l border-border bg-muted/30 p-4 overflow-y-auto", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("chatContext.title")}</h3>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* Контакти учня */}
          {contact && (contact.email || contact.phone) && (
            <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid #eceef3", background: "#fff" }}>
              {contact.email && (
                <div className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderBottom: contact.phone ? "1px solid #f3f4f8" : "none" }}>
                  <span style={{ color: "#b0b4c8", flexShrink: 0 }}>📧</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] uppercase tracking-wide" style={{ color: "#b0b4c8", fontFamily: "Inter, system-ui" }}>Email</p>
                    <p className="text-[14px] truncate" style={{ color: "#0f0f1a" }}>{contact.email}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(contact.email!); toast.success("Email скопійовано", { description: contact.email! }); }}
                    className="p-1.5 rounded-full hover:bg-gray-100 flex-shrink-0" style={{ color: "#9398b0" }} title="Копіювати">
                    <Copy size={19} strokeWidth={2} />
                  </button>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span style={{ color: "#b0b4c8", flexShrink: 0 }}>📞</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] uppercase tracking-wide" style={{ color: "#b0b4c8", fontFamily: "Inter, system-ui" }}>Телефон</p>
                    <p className="text-[14px] truncate" style={{ color: "#0f0f1a" }}>{contact.phone}</p>
                  </div>
                  <a href={`tel:${contact.phone}`} className="p-1.5 rounded-full hover:bg-gray-100 flex-shrink-0" style={{ color: "#1f8e7e" }} title="Подзвонити">
                    <Phone size={15} />
                  </a>
                  <button onClick={() => { navigator.clipboard.writeText(contact.phone!); toast.success("Телефон скопійовано", { description: contact.phone! }); }}
                    className="p-1.5 rounded-full hover:bg-gray-100 flex-shrink-0" style={{ color: "#9398b0" }} title="Копіювати">
                    <Copy size={19} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <p className="px-3 pt-3 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
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
                  <p className="text-[13px] text-muted-foreground">{nextLesson.subject}</p>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[13px] font-semibold",
                      nextLesson.student_payment_status === "paid"
                        ? "border-transparent bg-success/15 text-success"
                        : "border-transparent bg-warning/15 text-warning"
                    )}
                  >
                    {nextLesson.student_payment_status === "paid"
                      ? t("chatContext.paid")
                      : t("chatContext.unpaid")}
                  </span>
                  <span className="text-[13px] text-muted-foreground ml-auto">
                    Відкрити урок →
                  </span>
                </div>
              </Link>
            ) : (
              <p className="px-3 pb-3 text-[13px] text-muted-foreground">{t("chatContext.noUpcoming")}</p>
            )}
          </div>

          {unpaidCount > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/8 p-3">
              <p className="mb-1 text-[13px] font-medium uppercase tracking-wide text-warning">
                {t("chatContext.debt")}
              </p>
              <p className="text-sm font-semibold text-foreground">
                {t("chatContext.debtLessons", { count: unpaidCount })}
              </p>
              <Link
                to="/finances?filter=need_pay"
                className="mt-1.5 inline-block text-[13px] text-primary underline underline-offset-2"
              >
                {t("chatContext.viewDebts")}
              </Link>
            </div>
          )}

          {lastHomework && (
            <Link
              to={`/schedule?lesson=${lastHomework.id}`}
              className="block rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors"
            >
              <p className="mb-1.5 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("chatContext.lastHomework")}
              </p>
              <p className="text-[13px] text-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                {lastHomework.homework}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground flex items-center justify-between">
                <span>
                  {format(new Date(lastHomework.starts_at), "d MMM", { locale: dateLocale })}
                  {lastHomework.subject && ` · ${lastHomework.subject}`}
                </span>
                <span>Перейти →</span>
              </p>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
