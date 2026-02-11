import { useEffect } from "react";
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
import Chats from "./pages/Chats";
import KnowledgeBase from "./pages/KnowledgeBase";
import Workspaces from "./pages/Workspaces";
import Analytics from "./pages/Analytics";
import BrainStats from "./pages/BrainStats";
import PracticeCall from "./pages/PracticeCall";
import DashboardLayout from "./components/DashboardLayout";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

const App = () => {
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
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/install" element={<Install />} />
            <Route path="/chats" element={<AuthenticatedRoute><Chats /></AuthenticatedRoute>} />
            <Route path="/chats/:prospectId" element={<AuthenticatedRoute><Chats /></AuthenticatedRoute>} />
            <Route path="/knowledge-base" element={<AuthenticatedRoute><KnowledgeBase /></AuthenticatedRoute>} />
            <Route path="/workspaces" element={<AuthenticatedRoute><Workspaces /></AuthenticatedRoute>} />
            <Route path="/analytics" element={<AuthenticatedRoute><Analytics /></AuthenticatedRoute>} />
            <Route path="/brain" element={<AuthenticatedRoute><BrainStats /></AuthenticatedRoute>} />
            <Route path="/practice" element={<AuthenticatedRoute><PracticeCall /></AuthenticatedRoute>} />
            <Route path="/settings" element={<AuthenticatedRoute><Settings /></AuthenticatedRoute>} />
            <Route path="/dashboard" element={<Navigate to="/chats" replace />} />
            <Route path="*" element={<NotFound />} />
      </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
