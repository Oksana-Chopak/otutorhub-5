import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import { logError } from "@/lib/errorLog";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * A5: коли значення змінюється (навігація), межа СКИДАЄ стан помилки —
   * без key={pathname}, який перемонтовував усе піддерево (і всі його
   * запити з realtime-хендшейками) на КОЖЕН перехід, навіть без помилки.
   */
  resetKey?: unknown;
  /**
   * B11: вихід із краху без window.location.reload() — навігація на головну
   * зберігає незбережений стан інших частин застосунку (чернетки, кеш).
   */
  onHome?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    void logError(error.message, error.stack, { componentStack: info.componentStack?.slice(0, 4000) });
  }

  componentDidUpdate(prevProps: Props) {
    // Скидаємось лише КОЛИ вже впали і користувач кудись перейшов —
    // у здоровому стані зміна resetKey нічого не перемонтовує.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private goHome = () => {
    this.setState({ hasError: false, error: null });
    this.props.onHome?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-2xl font-semibold">{i18n.t("errorBoundary.title")}</p>
            {/* BUG-3 (2026-07-25): never surface raw error.message (technical
                English stack text) to users — details go to console + logError
                above and are visible in ErrorLogPage. Show friendly copy only. */}
            <p className="text-muted-foreground text-sm max-w-md">
              {i18n.t("errorBoundary.unknownError")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {this.props.onHome && (
                <Button onClick={this.goHome}>{i18n.t("errorBoundary.home")}</Button>
              )}
              <Button
                variant={this.props.onHome ? "outline" : "default"}
                onClick={() => window.location.reload()}
              >
                {i18n.t("errorBoundary.reload")}
              </Button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
