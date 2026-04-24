import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { FeedbackButton } from "./FeedbackButton";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto pb-16 lg:pb-0">
        <div className="mx-auto max-w-6xl px-4 pt-4 pb-6 lg:px-8 lg:pt-8 lg:py-8">
          {children}
        </div>
      </main>
      <MobileBottomNav />
      <FeedbackButton />
    </div>
  );
}
