import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import DashboardPage from "./pages/DashboardPage";
import SchedulePage from "./pages/SchedulePage";
import FinancesPage from "./pages/FinancesPage";
import ChatsPage from "./pages/ChatsPage";
import PeoplePage from "./pages/PeoplePage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AuditLogPage from "./pages/AuditLogPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
            <Route
              path="/finances"
              element={
                <ProtectedRoute allowedRoles={["manager"]}>
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
