import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import LandingPage from "./LandingPage";

const Index = () => {
  const { user, loading, roles, signOut } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) {
    // Roles not resolved yet (fresh signup/confirm before user_roles propagates) —
    // hold the loader instead of flashing the tutor/manager dashboard at a
    // role-less user and letting it self-correct a render later.
    if (roles.length === 0) {
      // P4: раніше — вічний спінер без виходу. Даємо ім'я стану і двері.
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="max-w-sm text-[15px] text-muted-foreground">{t("index.rolePending")}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => window.location.reload()}
              className="rounded-full border px-4 py-2 text-sm font-semibold">{t("index.retry")}</button>
            <button type="button" onClick={() => void signOut()}
              className="rounded-full border px-4 py-2 text-sm font-semibold text-muted-foreground">{t("index.signOut")}</button>
          </div>
        </div>
      );
    }
    // Student-only users get their dedicated dashboard.
    const isStudentOnly =
      roles.includes("student") && !roles.includes("manager") && !roles.includes("tutor");
    return <Navigate to={isStudentOnly ? "/student-dashboard" : "/dashboard"} replace />;
  }

  return <LandingPage />;
};

export default Index;
