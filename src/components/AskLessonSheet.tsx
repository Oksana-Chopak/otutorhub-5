import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHaptic } from "@/hooks/useHaptic";
import { useTimeZones } from "@/hooks/useTimeZones";
import { DateTimeField } from "@/components/DateTimeField";
import { Textarea } from "@/components/ui/textarea";
import { AREA_CLASS, FieldLabel } from "@/components/form/canon";
import { FormSheet, SheetButton } from "@/components/form/FormSheet";
import { getLocale } from "@/lib/locale";
import { zoneSuffix } from "@/lib/timeZone";
import { logEvent } from "@/lib/analytics";

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Адреса, яку відкриває сповіщення репетитора: форма уроку з цим учнем і цим часом. */
export function askLessonLink(studentId: string, at: Date): string {
  const iso = at.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `/schedule?create=1&student=${studentId}&at=${encodeURIComponent(iso)}`;
}

/**
 * «Попросити урок» (21.11, рішення власниці п. 4: один розклад учня замість двох).
 *
 * Досі учень мав два розклади: свій (перенести, скасувати) і загальний, де бачив вільні
 * години репетитора й мав домовлятися в чаті. Тепер вільні години — у його розкладі, і дотик
 * по годині відкриває цей аркуш: час уже стоїть, можна дописати слово. Урок учень НЕ
 * створює (уроки ставить репетитор або менеджер) — летить сповіщення репетитору, а дотик по
 * ньому відкриває форму уроку вже з цим учнем і цим часом. Час у тексті — за годинником
 * учня, з хвостиком поясу (правило 14.11: час у тексті для іншої людини несе пояс автора).
 */
export function AskLessonSheet({
  open, onOpenChange, tutorId, tutorName, initialAt, studentName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tutorId: string;
  tutorName: string;
  initialAt: Date;
  studentName: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const haptic = useHaptic();
  const zones = useTimeZones([tutorId]);
  const [when, setWhen] = useState(() => toLocalInputValue(initialAt));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWhen(toLocalInputValue(initialAt));
    setNote("");
  }, [open, initialAt]);

  const send = async () => {
    if (!user || busy) return;
    const at = new Date(when);
    if (!when || Number.isNaN(at.getTime())) { toast.error(t("askLesson.timeRequired")); return; }
    if (at.getTime() <= Date.now()) { toast.error(t("askLesson.inPast")); return; }
    setBusy(true);
    try {
      const whenText = at.toLocaleString(getLocale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + zoneSuffix(at);
      const comment = note.trim().slice(0, 300);
      // Тип із власним id: create_notification ковтає повтор того самого типу за добу,
      // а друге прохання за день — це друге прохання.
      const { error } = await supabase.rpc("create_notification", {
        _user_id: tutorId,
        _type: `lesson_ask_${crypto.randomUUID()}`,
        _title: t("askLesson.notifTitle", { name: studentName || t("shared.student"), when: whenText }),
        _body: comment || t("askLesson.notifBody"),
        _link: askLessonLink(user.id, at),
      });
      if (error) {
        haptic.error();
        toast.error(t("askLesson.failed"));
        return;
      }
      haptic.success();
      logEvent("lesson_asked");
      toast.success(t("askLesson.sent", { tutor: tutorName }), { description: t("askLesson.sentDesc") });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      testId="ask-lesson"
      title={t("askLesson.title")}
      description={t("askLesson.desc", { tutor: tutorName })}
      footer={
        <>
          <SheetButton kind="secondary" onClick={() => onOpenChange(false)}>{t("common.close")}</SheetButton>
          <SheetButton onClick={() => void send()} busy={busy}>{t("askLesson.send")}</SheetButton>
        </>
      }
    >
      <div>
        <FieldLabel>{t("askLesson.timeLabel")}</FieldLabel>
        <DateTimeField
          value={when}
          onChange={setWhen}
          min={toLocalInputValue(new Date())}
          zoneNote="others"
          zonePeople={[{ name: tutorName, tz: zones[tutorId] }]}
        />
      </div>
      <div>
        <FieldLabel htmlFor="ask-lesson-note" hint={t("askLesson.optional")}>{t("askLesson.noteLabel")}</FieldLabel>
        <Textarea
          id="ask-lesson-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("askLesson.notePlaceholder")}
          maxLength={300}
          className={AREA_CLASS}
        />
      </div>
    </FormSheet>
  );
}
