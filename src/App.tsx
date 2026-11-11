import { Suspense, useEffect } from "react";
import { DeepLinkListener } from "@/components/DeepLinkListener";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BUILD_TAG } from "@/lib/buildInfo";
import { RQ_PERSIST_KEY, registerQueryClient } from "@/lib/localCaches";
import { initOfflineQueue } from "@/lib/offlineQueue";
import { BrowserRouter, Route, Routes, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useGlobalChatToasts } from "@/hooks/useGlobalChatToasts";
import { useAndroidBackButton } from "@/hooks/useAndroidBackButton";
import { useNativeExternalLinks } from "@/hooks/useNativeExternalLinks";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/AppLayout";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { installGlobalErrorLogging } from "@/lib/errorLog";
import { lazyPage } from "@/lib/lazyPage";
import { ClarityIdentify } from "./components/ClarityIdentify";
import { CookieConsent } from "./components/CookieConsent";
import { Loader2 } from "lucide-react";

// Route-level code splitting: each page becomes its own chunk, loaded on demand.
const Index = lazyPage(() => import("./pages/Index"));
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"));
const SchedulePage = lazyPage(() => import("./pages/SchedulePage"));
const FinancesPage = lazyPage(() => import("./pages/FinancesPage"));
const ChatsPage = lazyPage(() => import("./pages/ChatsPage"));
const PeoplePage = lazyPage(() => import("./pages/PeoplePage"));
const AvailabilityPage = lazyPage(() => import("./pages/AvailabilityPage"));
const AuditLogPage = lazyPage(() => import("./pages/AuditLogPage"));
const AdminStatsPage = lazyPage(() => import("./pages/AdminStatsPage"));
const ErrorLogPage = lazyPage(() => import("./pages/ErrorLogPage"));

// Capture uncaught errors + rejections globally → error_log (managers see them on /errors).
installGlobalErrorLogging();
const FeedbackInboxPage = lazyPage(() => import("./pages/FeedbackInboxPage"));
const AuthPage = lazyPage(() => import("./pages/AuthPage"));
const OAuthConsent = lazyPage(() => import("./pages/OAuthConsent"));
const ResetPasswordPage = lazyPage(() => import("./pages/ResetPasswordPage"));
const OnboardingPage = lazyPage(() => import("./pages/OnboardingPage"));
const MyStudentsPage = lazyPage(() => import("./pages/MyStudentsPage"));
const GroupsPage = lazyPage(() => import("./pages/GroupsPage"));
const ReferralsPage = lazyPage(() => import("./pages/ReferralsPage"));
const MyReferralsPage = lazyPage(() => import("./pages/MyReferralsPage"));
const AchievementsPage = lazyPage(() => import("./pages/AchievementsPage"));
const JoinPage = lazyPage(() => import("./pages/JoinPage"));
const PayLinkPage = lazyPage(() => import("./pages/PayLinkPage"));
const SchoolPublicPage = lazyPage(() => import("./pages/SchoolPublicPage"));
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"));
const SubscriptionPage = lazyPage(() => import("./pages/SubscriptionPage"));
const SubscriptionRequestsPage = lazyPage(() => import("./pages/SubscriptionRequestsPage"));
const NotFound = lazyPage(() => import("./pages/NotFound"));
const FeedbackPreviewPage = lazyPage(() => import("./pages/FeedbackPreviewPage"));
const PaywallMetricsPage = lazyPage(() => import("./pages/PaywallMetricsPage"));
const WalletsPage = lazyPage(() => import("./pages/WalletsPage"));
const UnsubscribePage = lazyPage(() => import("./pages/UnsubscribePage"));
const MarketingPage = lazyPage(() => import("./pages/MarketingPage"));
const MarketingUnsubscribePage = lazyPage(() => import("./pages/MarketingUnsubscribePage"));
const LandingPage = lazyPage(() => import("./pages/LandingPage"));
const ForStudentsPage = lazyPage(() => import("./pages/ForStudentsPage"));
const TermsPage = lazyPage(() => import("./pages/TermsPage"));
const PrivacyPage = lazyPage(() => import("./pages/PrivacyPage"));
const StudentDashboardPage = lazyPage(() => import("./pages/student/StudentDashboardPage"));
const StudentSchedulePage = lazyPage(() => import("./pages/student/StudentSchedulePage"));
const StudentAchievementsPage = lazyPage(() => import("./pages/student/StudentAchievementsPage"));
const StudentPaymentsPage = lazyPage(() => import("./pages/student/StudentPaymentsPage"));
const StudentHomeworkPage = lazyPage(() => import("./pages/student/StudentHomeworkPage"));
const StudentProfilePage = lazyPage(() => import("./pages/student/StudentProfilePage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // D (офлайн): кеш живе добу, бо персиститься на диск — холодний старт
      // без мережі малює останні дані миттєво, свіжі доїжджають за staleTime.
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
registerQueryClient(queryClient);

// D (офлайн): кеш react-query переживає перезавантаження (localStorage);
// BUILD_TAG як buster — новий реліз не читає старий формат кеша.
// Ключ один на застосунок (src/lib/localCaches.ts): «Вийти» стирає саме його.
const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: RQ_PERSIST_KEY,
  throttleTime: 2000,
});

const RouteFallback = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// A5: AppLayout живе в layout-route і НЕ перемонтовується при навігації.
// Раніше кожен таб-перехід перебудовував AppLayout → AppSidebar → усі їхні хуки
// (~10–16 запитів і 4 realtime-хендшейки за перехід). Межа помилок — всередині
// лейауту: крах сторінки лишає сайдбар і нижнє меню живими (B11), «На головну»
// працює без reload і не втрачає незбережене.
function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <AppLayout>
      <ErrorBoundary resetKey={location.pathname} onHome={() => navigate("/dashboard")}>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppLayout>
  );
}

function AppRoutes() {
  // D (офлайн): реплей черги мутацій при старті/поверненні мережі.
  useEffect(() => initOfflineQueue(), []);
  // Subscribe to global new-message toasts (no UI)
  useGlobalChatToasts();
  // Android hardware back: close open sheets/dialogs, double-press to exit (BUG-4)
  useAndroidBackButton();
  // Native: route every external target="_blank" anchor through the system browser (BUG-6)
  useNativeExternalLinks();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <ClarityIdentify />
      {/* 13.10: на публічній сторінці оплати (/pay/<токен>) банера про куки немає —
          її відкривають батьки з месенджера без акаунта, щоб побачити борг і натиснути
          «Я оплатив(ла)»; питання про аналітику там лише заступало кнопку (робот показав),
          а Clarity без згоди і так не вантажиться. */}
      {!location.pathname.startsWith("/pay/") && !location.pathname.startsWith("/p/") && <CookieConsent />}
      <Suspense fallback={<RouteFallback />}>
        {/* A5: остання межа БЕЗ key={pathname} — раніше key перемонтовував усе
            дерево на кожен перехід. Тепер межа скидається лише після краху
            (resetKey) і має вихід «На головну» без reload (B11). */}
        <ErrorBoundary resetKey={location.pathname} onHome={() => navigate("/")}>
          <DeepLinkListener />
          <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/feedback-preview" element={<FeedbackPreviewPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/marketing-unsubscribe" element={<MarketingUnsubscribePage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          {/* 13.10: публічна сторінка оплати за магічним посиланням — без входу і без лейауту */}
          <Route path="/pay/:token" element={<PayLinkPage />} />
          <Route path="/p/:token" element={<PayLinkPage />} />
          {/* 11.11: публічна сторінка школи «Записатись» — без входу; вмикає її менеджер школи */}
          <Route path="/s/:slug" element={<SchoolPublicPage />} />
          <Route path="/" element={<Index />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/for-students" element={<ForStudentsPage />} />
          {/* Онбординг — повноекранний, без спільного лейауту */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute allowedRoles={["tutor"]}>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          {/* Analytics is now merged into Finances — keep the path as a redirect. */}
          <Route path="/analytics" element={<Navigate to="/finances" replace />} />
          {/* A5: усі сторінки зі спільним хромом — під одним AppShell */}
          <Route element={<AppShell />}>
            <Route path="/chats" element={<ProtectedRoute><ChatsPage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
            <Route path="/finances" element={<ProtectedRoute allowedRoles={["manager", "tutor"]}><FinancesPage /></ProtectedRoute>} />
            <Route path="/availability" element={<ProtectedRoute allowedRoles={["manager", "tutor"]}><AvailabilityPage /></ProtectedRoute>} />
            <Route path="/people" element={<ProtectedRoute allowedRoles={["manager"]}><PeoplePage /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute allowedRoles={["manager"]}><AuditLogPage /></ProtectedRoute>} />
            {/* Аудит 01.09: єдиний маршрут без allowedRoles — учень чи хабовий репетитор
                відкривали сторінку й бачили замок. Витоку не було (тримає RLS), але
                маршрут має збігатися з тим, що показує сайдбар. */}
            <Route path="/admin" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><AdminStatsPage /></ProtectedRoute>} />
            {/* Red team 20.10: ці дані в базі платформні (RLS/RPC — is_superadmin()), тож і
                маршрут, і пункт у сайдбарі — лише для суперадміна, не для кожного менеджера. */}
            <Route path="/errors" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><ErrorLogPage /></ProtectedRoute>} />
            <Route path="/feedback-inbox" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><FeedbackInboxPage /></ProtectedRoute>} />
            <Route path="/marketing" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><MarketingPage /></ProtectedRoute>} />
            <Route path="/my-students" element={<ProtectedRoute allowedRoles={["tutor"]}><MyStudentsPage /></ProtectedRoute>} />
            <Route path="/groups" element={<ProtectedRoute allowedRoles={["tutor", "manager"]}><GroupsPage /></ProtectedRoute>} />
            <Route path="/referrals" element={<ProtectedRoute allowedRoles={["manager"]}><ReferralsPage /></ProtectedRoute>} />
            <Route path="/my-referrals" element={<ProtectedRoute allowedRoles={["tutor"]}><MyReferralsPage /></ProtectedRoute>} />
            <Route path="/achievements" element={<ProtectedRoute allowedRoles={["tutor", "student"]}><AchievementsPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute allowedRoles={["tutor", "manager"]}><ProfilePage /></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute allowedRoles={["tutor"]}><SubscriptionPage /></ProtectedRoute>} />
            <Route path="/subscription-requests" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><SubscriptionRequestsPage /></ProtectedRoute>} />
            <Route path="/paywall-metrics" element={<ProtectedRoute allowedRoles={["manager"]} superadmin><PaywallMetricsPage /></ProtectedRoute>} />
            <Route path="/wallets" element={<ProtectedRoute allowedRoles={["manager", "tutor"]}><WalletsPage /></ProtectedRoute>} />
            <Route path="/student-dashboard" element={<ProtectedRoute allowedRoles={["student"]}><StudentDashboardPage /></ProtectedRoute>} />
            <Route path="/student/schedule" element={<ProtectedRoute allowedRoles={["student"]}><StudentSchedulePage /></ProtectedRoute>} />
            <Route path="/student/achievements" element={<ProtectedRoute allowedRoles={["student"]}><StudentAchievementsPage /></ProtectedRoute>} />
            <Route path="/student/payments" element={<ProtectedRoute allowedRoles={["student"]}><StudentPaymentsPage /></ProtectedRoute>} />
            <Route path="/student/homework" element={<ProtectedRoute allowedRoles={["student"]}><StudentHomeworkPage /></ProtectedRoute>} />
            <Route path="/student/profile" element={<ProtectedRoute allowedRoles={["student"]}><StudentProfilePage /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </Suspense>
    </>
  );
}

const App = () => (
  <ErrorBoundary>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: BUILD_TAG }}
    >
      <ThemeProvider>
        <TooltipProvider>
          {/* A1: локалі ліниві — усе, що викликає useTranslation (ConfirmProvider,
              CookieConsent…), мусить жити під Suspense, поки чанк мови їде. */}
          <Suspense fallback={<RouteFallback />}>
          <ConfirmProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </BrowserRouter>
          </ConfirmProvider>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  </ErrorBoundary>
);

export default App;
