import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth, AppRole } from "@/hooks/useAuth";

interface Props {
  children: ReactNode;
  allowedRoles?: AppRole[];
}

function AppLoadingSkeleton() {
  return (
    <div className="flex h-screen bg-[#F5F4F0]">
      {/* Sidebar skeleton */}
      <div className="hidden w-[68px] flex-col gap-3 bg-[#0f0f1a] px-3 py-4 lg:flex">
        <div className="mx-auto h-8 w-8 rounded-full bg-white/10" />
        <div className="mt-4 flex flex-col gap-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-9 w-9 rounded-[10px] bg-white/06 animate-pulse" />
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex flex-1 flex-col p-6 gap-4">
        <div className="h-8 w-48 rounded-xl bg-gray-200 animate-pulse" />
        <div className="h-4 w-64 rounded-lg bg-gray-100 animate-pulse" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-[16px] border border-gray-100 bg-white animate-pulse" />
          ))}
        </div>
        <div className="flex flex-col gap-3 mt-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-[16px] border border-gray-100 bg-white animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, checkRole, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoadingSkeleton />;
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const hasAccess = allowedRoles.some((r) => checkRole(r));
    if (!hasAccess) {
      const isStudentOnly =
        checkRole("student") && !checkRole("manager") && !checkRole("tutor");
      return <Navigate to={isStudentOnly ? "/student-dashboard" : "/"} replace />;
    }
  }

  return <>{children}</>;
}
