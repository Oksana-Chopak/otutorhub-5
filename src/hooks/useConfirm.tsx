import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /** When set, the user must type this exact string to enable the confirm button. */
  requireText?: string;
  requireTextLabel?: string;
}

type ConfirmFn = (opts?: ConfirmOptions) => Promise<boolean>;

// Module-level handle so non-component code can call confirmDialog() like toast().
let _confirm: ConfirmFn | null = null;

/**
 * Imperative, promise-based confirmation that works inside the iOS/Android
 * WebView, where the native window.confirm / alert / prompt are blocked and
 * return immediately. Resolves `false` if no provider is mounted.
 *
 * Usage:  if (!(await confirmDialog({ description: "…" }))) return;
 */
export const confirmDialog: ConfirmFn = (opts) =>
  _confirm ? _confirm(opts) : Promise.resolve(false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<ConfirmOptions>({});
  const [typed, setTyped] = React.useState("");
  const resolver = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    setOpts(options ?? {});
    setTyped("");
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  React.useEffect(() => {
    _confirm = confirm;
    return () => {
      if (_confirm === confirm) _confirm = null;
    };
  }, [confirm]);

  const settle = (value: boolean) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(value);
  };

  const needText = typeof opts.requireText === "string" && opts.requireText.length > 0;
  const canConfirm = !needText || typed.trim() === opts.requireText;

  return (
    <>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialogContent className="max-w-[400px] rounded-[20px] sm:rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title ?? t("common.pleaseConfirm")}</AlertDialogTitle>
            {opts.description ? (
              <AlertDialogDescription className="whitespace-pre-line">
                {opts.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          {needText ? (
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) settle(true);
              }}
              placeholder={opts.requireTextLabel ?? opts.requireText}
              aria-label={opts.requireTextLabel ?? opts.requireText}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts.cancelText ?? t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canConfirm}
              onClick={() => settle(true)}
              className={cn(
                "disabled:pointer-events-none disabled:opacity-50",
                opts.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {opts.confirmText ?? t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
