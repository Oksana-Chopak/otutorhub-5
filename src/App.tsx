import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useGlobalChatToasts } from "@/hooks/useGlobalChatToasts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
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
import GroupsPage from "./pages/GroupsPage";
import ReferralsPage from "./pages/ReferralsPage";
import MyReferralsPage from "./pages/MyReferralsPage";
import AchievementsPage from "./pages/AchievementsPage";
import JoinPage from "./pages/JoinPage";
import ProfilePage from "./pages/ProfilePage";
import SubscriptionPage from "./pages/SubscriptionPage";
import SubscriptionRequestsPage from "./pages/SubscriptionRequestsPage";
import NotFound from "./pages/NotFound";
import FeedbackPreviewPage from "./pages/FeedbackPreviewPage";
import PremiumAnalyticsPage from "./pages/PremiumAnalyticsPage";
import PaywallMetricsPage from "./pages/PaywallMetricsPage";
import WalletsPage from "./pages/WalletsPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import MarketingPage from "./pages/MarketingPage";
import MarketingUnsubscribePage from "./pages/MarketingUnsubscribePage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import StudentDashboardPage from "./pages/student/StudentDashboardPage";
import StudentSchedulePage from "./pages/student/StudentSchedulePage";
import StudentPaymentsPage from "./pages/student/StudentPaymentsPage";
import StudentHomeworkPage from "./pages/student/StudentHomeworkPage";
import StudentProfilePage from "./pages/student/StudentProfilePage";
import { ClarityIdentify } from "./components/ClarityIdentify";

const queryClient = new QueryClient();

function AppRoutes() {
  // Subscribe to global new-message toasts (no UI)
  useGlobalChatToasts();
  return (
    <>
      <ClarityIdentify />
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/feedback-preview" element={<FeedbackPreviewPage />} />
      <Route path="/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/marketing-unsubscribe" element={<MarketingUnsubscribePage />} />
      <Route
        path="/marketing"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <MarketingPage />
          </ProtectedRoute>
        }
      />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/" element={<Index />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
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
        path="/groups"
        element={
          <ProtectedRoute allowedRoles={["tutor", "manager"]}>
            <GroupsPage />
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
        path="/my-referrals"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <MyReferralsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/achievements"
        element={
          <ProtectedRoute allowedRoles={["tutor"]}>
            <AchievementsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute allowedRoles={["tutor", "manager"]}>
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
      <Route
        path="/paywall-metrics"
        element={
          <ProtectedRoute allowedRoles={["manager"]}>
            <PaywallMetricsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/wallets"
        element={
          <ProtectedRoute allowedRoles={["manager", "tutor"]}>
            <WalletsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student-dashboard"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <StudentDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/schedule"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <StudentSchedulePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/payments"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <StudentPaymentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/homework"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <StudentHomeworkPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/profile"
        element={
          <ProtectedRoute allowedRoles={["student"]}>
            <StudentProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

const App = () => (
  <ErrorBoundary>
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
  </ErrorBoundary>
);

export default App;
