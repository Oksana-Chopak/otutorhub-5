import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

interface Props {
  children: ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, checkRole, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const hasAccess = allowedRoles.some((r) => checkRole(r));
    if (!hasAccess) {
      // Student-only users denied a tutor/manager page → send to their cabinet.
      const isStudentOnly =
        checkRole("student") && !checkRole("manager") && !checkRole("tutor");
      return <Navigate to={isStudentOnly ? "/student-dashboard" : "/"} replace />;
    }
  }

  return <>{children}</>;
}
