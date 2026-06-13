import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * oTutorHub toasts — bright, on-brand, encouraging.
 * One place styles every toast.success/error/info across the app (no need to
 * touch the 300+ call sites). Each type gets its own gradient accent, a friendly
 * icon, a rounded card, a soft glow, and a slightly longer dwell so the message
 * actually registers.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      duration={4200}
      visibleToasts={3}
      gap={10}
      closeButton
      icons={{
        success: <CheckCircle2 className="h-5 w-5" style={{ color: "#16a34a" }} />,
        error: <XCircle className="h-5 w-5" style={{ color: "#e0552f" }} />,
        info: <Info className="h-5 w-5" style={{ color: "#2BBFAA" }} />,
        warning: <AlertTriangle className="h-5 w-5" style={{ color: "#B4740B" }} />,
      }}
      toastOptions={{
        classNames: {
          toast: "oth-toast",
          title: "oth-toast-title",
          description: "oth-toast-desc",
          actionButton: "oth-toast-action",
          cancelButton: "oth-toast-cancel",
        },
      }}
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      {...props}
    />
  );
};

export { Toaster, toast };
