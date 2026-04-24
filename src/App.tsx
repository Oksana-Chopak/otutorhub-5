import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useGlobalChatToasts } from "@/hooks/useGlobalChatToasts";
import DashboardPage from "./pages/DashboardPage";
import SchedulePage from "./pages/SchedulePage";
import FinancesPage from "./pages/FinancesPage";
import ChatsPage from "./pages/ChatsPage";
import PeoplePage from "./pages/PeoplePage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AuditLogPage from "./pages/AuditLogPage";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OnboardingPage from "./pages/OnboardingPage";
import MyStudentsPage from "./pages/MyStudentsPage";
import ReferralsPage from "./pages/ReferralsPage";
import ProfilePage from "./pages/ProfilePage";
import SubscriptionPage from "./pages/SubscriptionPage";
import SubscriptionRequestsPage from "./pages/SubscriptionRequestsPage";
import NotFound from "./pages/NotFound";
import FeedbackPreviewPage from "./pages/FeedbackPreviewPage";
import PremiumAnalyticsPage from "./pages/PremiumAnalyticsPage";

const queryClient = new QueryClient();

function AppRoutes() {
  // Subscribe to global new-message toasts (no UI)
  useGlobalChatToasts();
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/feedback-preview" element={<FeedbackPreviewPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
      <Route
        path="/finances"
        element={
          <ProtectedRoute allowedRoles={["manager", "tutor"]}>
            <FinancesPage />
          </ProtectedRoute>
        }
      />
      <Route path="/chats" element={<ProtectedRoute><ChatsPage /></ProtectedRoute>} />
      <Route
        path="/availability"
        element={
          <ProtectedRoute allowedRoles={["manager", "tutor"]}>
            <AvailabilityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/people"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <PeoplePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <AuditLogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-students"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <MyStudentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/referrals"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <ReferralsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <SubscriptionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <PremiumAnalyticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription-requests"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <SubscriptionRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
