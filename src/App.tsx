import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Home from "./pages/Home";
import Install from "./pages/Install";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import DashboardLayout from "./components/DashboardLayout";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import AppLaunchScreen, { shouldShowAppLaunch } from "./components/AppLaunchScreen";

const Chats = lazy(() => import("./pages/Chats"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const Workspaces = lazy(() => import("./pages/Workspaces"));
const Analytics = lazy(() => import("./pages/Analytics"));
const BrainStats = lazy(() => import("./pages/BrainStats"));
const PracticeCall = lazy(() => import("./pages/PracticeCall"));
const AiChat = lazy(() => import("./pages/AiChat"));
const Settings = lazy(() => import("./pages/Settings"));
const Company = lazy(() => import("./pages/Company"));
const Evaluations = lazy(() => import("./pages/Evaluations"));


const queryClient = new QueryClient();

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  return <DashboardLayout><Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading feature…</div>}>{children}</Suspense></DashboardLayout>;
}

const App = () => {
  const [showLaunch, setShowLaunch] = useState(shouldShowAppLaunch);
  const completeLaunch = useCallback(() => setShowLaunch(false), []);

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      console.error("Unhandled promise rejection:", e.reason);
    };
    window.addEventListener("unhandledrejection", handler);

    // Capture PWA install prompt globally so it's not missed
    const installHandler = (e: Event) => {
      e.preventDefault();
      (window as any).__pwaInstallPrompt = e;
      window.dispatchEvent(new Event("pwa-prompt-ready"));
    };
    window.addEventListener("beforeinstallprompt", installHandler);

    return () => {
      window.removeEventListener("unhandledrejection", handler);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, []);

  return (
  <>
  {showLaunch && <AppLaunchScreen onComplete={completeLaunch} />}
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

            <Route path="/signup" element={<SignUp />} />
            <Route path="/install" element={<Install />} />
            <Route path="/chats" element={<AuthenticatedRoute><Chats /></AuthenticatedRoute>} />
            <Route path="/chats/:prospectId" element={<AuthenticatedRoute><Chats /></AuthenticatedRoute>} />
            <Route path="/knowledge-base" element={<AuthenticatedRoute><KnowledgeBase /></AuthenticatedRoute>} />
            <Route path="/workspaces" element={<AuthenticatedRoute><Workspaces /></AuthenticatedRoute>} />
            <Route path="/analytics" element={<AuthenticatedRoute><Analytics /></AuthenticatedRoute>} />
            <Route path="/evaluations" element={<AuthenticatedRoute><Evaluations /></AuthenticatedRoute>} />
            <Route path="/brain" element={<AuthenticatedRoute><BrainStats /></AuthenticatedRoute>} />
            <Route path="/practice" element={<AuthenticatedRoute><PracticeCall /></AuthenticatedRoute>} />
            <Route path="/ai-chat" element={<AuthenticatedRoute><AiChat /></AuthenticatedRoute>} />
            <Route path="/settings" element={<AuthenticatedRoute><Settings /></AuthenticatedRoute>} />
            <Route path="/company" element={<AuthenticatedRoute><Company /></AuthenticatedRoute>} />
            <Route path="/dashboard" element={<Navigate to="/chats" replace />} />
            <Route path="*" element={<NotFound />} />
      </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </>
  );
};

export default App;
