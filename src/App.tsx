import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardPage from "./pages/DashboardPage";
import SchedulePage from "./pages/SchedulePage";
import FinancesPage from "./pages/FinancesPage";
import ChatsPage from "./pages/ChatsPage";
import PeoplePage from "./pages/PeoplePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/finances" element={<FinancesPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
