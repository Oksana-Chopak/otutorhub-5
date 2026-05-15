import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";

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
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-2xl font-semibold">Щось пішло не так 😕</p>
            <p className="text-muted-foreground text-sm max-w-md">
              {this.state.error?.message ?? "Невідома помилка"}
            </p>
            <Button onClick={() => window.location.reload()}>Перезавантажити</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
