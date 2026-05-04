import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import LandingPage from "./LandingPage";

const Index = () => {
  const { user, loading, roles } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) {
    // Student-only users get their dedicated dashboard.
    const isStudentOnly =
      roles.includes("student") && !roles.includes("manager") && !roles.includes("tutor");
    return <Navigate to={isStudentOnly ? "/student-dashboard" : "/dashboard"} replace />;
  }

  return <LandingPage />;
};

export default Index;
