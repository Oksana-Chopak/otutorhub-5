import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import { logError } from "@/lib/errorLog";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
            <Button onClick={() => window.location.reload()}>{i18n.t("errorBoundary.reload")}</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
