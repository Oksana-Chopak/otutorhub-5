import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useGlobalChatToasts } from "@/hooks/useGlobalChatToasts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { installGlobalErrorLogging } from "@/lib/errorLog";
import { ClarityIdentify } from "./components/ClarityIdentify";
import { CookieConsent } from "./components/CookieConsent";
import { Loader2 } from "lucide-react";

// Route-level code splitting: each page becomes its own chunk, loaded on demand.
const Index = lazy(() => import("./pages/Index"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const FinancesPage = lazy(() => import("./pages/FinancesPage"));
const ChatsPage = lazy(() => import("./pages/ChatsPage"));
const PeoplePage = lazy(() => import("./pages/PeoplePage"));
const AvailabilityPage = lazy(() => import("./pages/AvailabilityPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const ErrorLogPage = lazy(() => import("./pages/ErrorLogPage"));

// Capture uncaught errors + rejections globally → error_log (managers see them on /errors).
installGlobalErrorLogging();
const FeedbackInboxPage = lazy(() => import("./pages/FeedbackInboxPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const MyStudentsPage = lazy(() => import("./pages/MyStudentsPage"));
const GroupsPage = lazy(() => import("./pages/GroupsPage"));
const ReferralsPage = lazy(() => import("./pages/ReferralsPage"));
const MyReferralsPage = lazy(() => import("./pages/MyReferralsPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const JoinPage = lazy(() => import("./pages/JoinPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage"));
const SubscriptionRequestsPage = lazy(() => import("./pages/SubscriptionRequestsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const FeedbackPreviewPage = lazy(() => import("./pages/FeedbackPreviewPage"));
const PaywallMetricsPage = lazy(() => import("./pages/PaywallMetricsPage"));
const WalletsPage = lazy(() => import("./pages/WalletsPage"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));
const MarketingPage = lazy(() => import("./pages/MarketingPage"));
const MarketingUnsubscribePage = lazy(() => import("./pages/MarketingUnsubscribePage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const StudentDashboardPage = lazy(() => import("./pages/student/StudentDashboardPage"));
const StudentSchedulePage = lazy(() => import("./pages/student/StudentSchedulePage"));
const StudentAchievementsPage = lazy(() => import("./pages/student/StudentAchievementsPage"));
const StudentPaymentsPage = lazy(() => import("./pages/student/StudentPaymentsPage"));
const StudentHomeworkPage = lazy(() => import("./pages/student/StudentHomeworkPage"));
const StudentProfilePage = lazy(() => import("./pages/student/StudentProfilePage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

function AppRoutes() {
  // Subscribe to global new-message toasts (no UI)
  useGlobalChatToasts();
  const location = useLocation();
  return (
    <>
      <ClarityIdentify />
      <CookieConsent />
      <Suspense fallback={<RouteFallback />}>
        {/* Per-route boundary: a runtime crash on one page shows the fallback but RESETS
            on navigation (keyed by pathname), so one bad page can't brick the session.
            The outer ErrorBoundary stays as the last-resort catch. */}
        <ErrorBoundary key={location.pathname}>
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
          <Route path="/landing" element={<LandingPage />} />
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
            path="/errors"
            element={
              <ProtectedRoute allowedRoles={["manager"]}>
                <ErrorLogPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/feedback-inbox"
            element={
              <ProtectedRoute allowedRoles={["manager"]}>
                <FeedbackInboxPage />
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
              <ProtectedRoute allowedRoles={["tutor", "student"]}>
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
          {/* Analytics is now merged into Finances — keep the path as a redirect. */}
          <Route path="/analytics" element={<Navigate to="/finances" replace />} />
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
            path="/student/achievements"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentAchievementsPage />
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
        </ErrorBoundary>
      </Suspense>
    </>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </BrowserRouter>
          </ConfirmProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
