import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

/**
 * Аудит 01.09: на жодній сторінці не було стану «не вдалося прочитати».
 * Провал читання малював `EmptyState` — тобто екран впевнено стверджував
 * «даних немає» там, де насправді «я не знаю». Репетитор із сорока учнями
 * бачив «Додайте першого учня», менеджер — «Прибуток 0 ₴».
 *
 * Це той самий компонент-близнюк до EmptyState, але з іншим змістом:
 * називає проблему і дає ОДНУ дію — спробувати ще.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h3 className="text-base font-semibold text-foreground">
        {title ?? t("errorState.title")}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description ?? t("errorState.description")}
      </p>
      <div className="mt-5">
        <Button size="sm" onClick={onRetry} disabled={retrying} className="tap-44">
          {retrying ? t("common.loading") : t("errorState.retry")}
        </Button>
      </div>
    </div>
  );
}
