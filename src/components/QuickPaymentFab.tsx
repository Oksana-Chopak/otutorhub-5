import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Wallet, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface UnpaidRow {
  id: string;
  starts_at: string;
  subject: string;
  student_id: string;
  student_price: number;
  student_name: string;
}

/**
 * Floating action button shown on the dashboard for tutors. Opens a sheet
 * with all unpaid completed lessons across all students for ultra-fast
 * "I just got paid" marking — works from anywhere on the dashboard with no
 * scrolling.
 */
export function QuickPaymentFab() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unpaidCount, setUnpaidCount] = useState(0);

  const refreshCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from("lesson_details")
      .select("lesson_id, lessons!inner(tutor_id, status, student_price)", { count: "exact", head: true })
      .eq("lessons.tutor_id", user.id)
      .eq("lessons.status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0);
    setUnpaidCount(count ?? 0);
  };

  useEffect(() => {
    refreshCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: details } = await supabase
      .from("lesson_details")
      .select("lesson_id, student_price, lessons!inner(id, starts_at, subject, student_id, tutor_id, status)")
      .eq("lessons.tutor_id", user.id)
      .eq("lessons.status", "completed")
      .eq("student_payment_status", "unpaid")
      .gt("student_price", 0)
      .limit(100);

    const lessons = (details ?? [])
      .map((d: any) => ({
        id: d.lessons.id,
        starts_at: d.lessons.starts_at,
        subject: d.lessons.subject,
        student_id: d.lessons.student_id,
        student_price: Number(d.student_price ?? 0),
      }))
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));

    const ids = Array.from(new Set(lessons.map((l) => l.student_id)));
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => {
        names[p.id] = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Учень";
      });
    }
    setRows(
      lessons.map((l) => ({
        ...l,
        student_name: names[l.student_id] ?? "Учень",
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const markPaid = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase
      .from("lesson_details")
      .update({ student_payment_status: "paid" })
      .eq("lesson_id", id);
    setBusyId(null);
    if (error) {
      toast.error("Не вдалося оновити");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
    setUnpaidCount((c) => Math.max(0, c - 1));
    toast.success("Позначено як оплачено");
  };

  if (unpaidCount === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-20 right-4 z-40 h-14 gap-2 rounded-full shadow-lg md:bottom-6 md:right-6"
          aria-label="Швидко відмітити оплату"
        >
          <Wallet className="h-5 w-5" />
          <span className="hidden sm:inline">Отримав оплату</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-bold">
            {unpaidCount}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Відмітити отриману оплату</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Немає неоплачених уроків 🎉
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {rows.map((r) => {
              const d = new Date(r.starts_at);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.student_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.subject} ·{" "}
                      {d.toLocaleDateString("uk-UA", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · <span className="font-medium text-foreground">{r.student_price} ₴</span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => markPaid(r.id)}
                    disabled={busyId === r.id}
                    className="gap-1"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Отримано
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
