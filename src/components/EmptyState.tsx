/**
 * EmptyState.tsx
 *
 * Нові можливості:
 * - variant: "default" | "subtle" | "highlight"
 * - hint: додатковий рядок підказки
 * - secondaryAction: другорядна кнопка
 * - Готові пресети: EmptyState.Students, EmptyState.Lessons тощо
 */

import { ReactNode } from "react";
import { LucideIcon, Users, CalendarDays, Wallet, MessageSquare, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import i18nInstance from "@/i18n";
const t = i18nInstance.t.bind(i18nInstance);

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
  className?: string;
  variant?: "default" | "subtle" | "highlight";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
  className,
  variant = "default",
}: EmptyStateProps) {
  const wrapperClass = {
    default:   "border-dashed border-border bg-card/50",
    subtle:    "border-transparent bg-muted/30",
    highlight: "border-primary/20 bg-primary/5",
  }[variant];

  const iconBgClass = {
    default:   "bg-primary/10 text-primary",
    subtle:    "bg-muted text-muted-foreground",
    highlight: "bg-primary/15 text-primary",
  }[variant];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border px-6 py-12 text-center",
        wrapperClass,
        className
      )}
    >
      {Icon && (
        <div className={cn("mb-4 flex h-14 w-14 items-center justify-center rounded-full", iconBgClass)}>
          <Icon className="h-7 w-7" />
        </div>
      )}

      <h3 className="text-base font-semibold text-foreground">{title}</h3>

      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}

      {hint && (
        <p className="mt-1 max-w-xs text-xs italic text-muted-foreground/70">{hint}</p>
      )}

      {(actionLabel || secondaryLabel || children) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction && (
            <Button onClick={onAction} size="sm">
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button onClick={onSecondary} size="sm" variant="outline">
              {secondaryLabel}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────

EmptyState.Students = function EmptyStateStudents({
  onAdd,
  onInvite,
}: {
  onAdd?: () => void;
  onInvite?: () => void;
}) {
  return (
    <EmptyState
      icon={Users}
      variant="highlight"
      title={t("onboardingContent.addStudentTitle")}
      description={t("onboardingContent.addStudentDesc")}
      hint={t("inviteLink.resendBtn")}
      actionLabel={t("onboardingContent.addStudentCta")}
      onAction={onAdd}
      secondaryLabel={t("inviteLinkExtra.resendBtn")}
      onSecondary={onInvite}
    />
  );
};

EmptyState.Lessons = function EmptyStateLessons({
  onSchedule,
}: {
  onSchedule?: () => void;
}) {
  return (
    <EmptyState
      icon={CalendarDays}
      variant="default"
      title={t("schedule.noLessons") ?? "Уроків поки немає"}
      description={t("schedule.noLessonsDesc") ?? "Запишіть перший урок — це займе 30 секунд."}
      actionLabel={t("schedule.addLesson") ?? "Запланувати урок"}
      onAction={onSchedule}
    />
  );
};

EmptyState.UpcomingLessons = function EmptyStateUpcoming({
  onSchedule,
  isTutor = false,
}: {
  onSchedule?: () => void;
  isTutor?: boolean;
}) {
  return (
    <EmptyState
      icon={CalendarDays}
      variant="subtle"
      title={t("schedule.noUpcoming") ?? "Наступних уроків немає"}
      description={
        isTutor
          ? "Створіть урок — він з'явиться тут одразу після збереження."
          : "Дату й час нових уроків додає ваш репетитор."
      }
      actionLabel={isTutor ? "Створити урок" : undefined}
      onAction={isTutor ? onSchedule : undefined}
    />
  );
};

EmptyState.Payments = function EmptyStatePayments() {
  return (
    <EmptyState
      icon={Wallet}
      variant="subtle"
      title={t("finances.noDebts") ?? "Заборгованостей немає"}
      description={t("finances.noDebtsDesc") ?? "Всі уроки оплачено. Гарна робота!"}
    />
  );
};

EmptyState.Messages = function EmptyStateMessages({
  onNewChat,
}: {
  onNewChat?: () => void;
}) {
  return (
    <EmptyState
      icon={MessageSquare}
      variant="subtle"
      title={t("chats.empty") ?? "Поки немає повідомлень"}
      description={t("chats.emptyDesc") ?? "Написати учню або репетитору можна прямо звідси."}
      actionLabel="Написати"
      onAction={onNewChat}
    />
  );
};

EmptyState.Analytics = function EmptyStateAnalytics() {
  return (
    <EmptyState
      icon={BarChart3}
      variant="subtle"
      title={t("analytics.noData") ?? "Даних ще недостатньо"}
      description={t("analytics.noDataDesc") ?? "Статистика з'явиться після перших проведених уроків."}
      hint="Зазвичай достатньо 3–5 занять."
    />
  );
};

EmptyState.AllClear = function EmptyStateAllClear() {
  return (
    <EmptyState
      title={t("emptyState.allClear")}
      description={t("emptyState.allClearDesc")}
      variant="subtle"
    />
  );
};
