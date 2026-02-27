import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  MessageSquare, Brain, Briefcase, BarChart3, LogOut, Building2,
  Sparkles, Moon, Sun, Settings, Phone, Bot, BookOpen, MoreHorizontal,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";

const primaryTabs = [
  { icon: MessageSquare, label: "Chats", path: "/chats" },
  { icon: Bot, label: "AI Chat", path: "/ai-chat" },
  { icon: Phone, label: "Practice", path: "/practice" },
  { icon: Sparkles, label: "Brain", path: "/brain" },
];

const moreTabs = [
  { icon: BookOpen, label: "Knowledge Base", path: "/knowledge-base" },
  { icon: Briefcase, label: "Workspaces", path: "/workspaces" },
  { icon: BarChart3, label: "Analytics", path: "/analytics" },
  { icon: Building2, label: "My Company", path: "/company" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <MobileShell>{children}</MobileShell>;
}

function MobileShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark") ||
        localStorage.getItem("theme") === "dark" ||
        (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isMoreActive = moreTabs.some(t => location.pathname.startsWith(t.path));

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Main content area */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav className="shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
        <div className="flex items-center justify-around h-14 px-1">
          {primaryTabs.map((tab) => {
            const isActive = location.pathname.startsWith(tab.path);
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={`flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </button>
            );
          })}

          {/* More tab */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={`flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors ${
                  isMoreActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <MoreHorizontal className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-8">
              <SheetHeader className="pb-2">
                <SheetTitle className="text-base">More</SheetTitle>
              </SheetHeader>

              <div className="space-y-1">
                {moreTabs.map((tab) => {
                  const isActive = location.pathname.startsWith(tab.path);
                  return (
                    <button
                      key={tab.path}
                      onClick={() => { navigate(tab.path); setMoreOpen(false); }}
                      className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl transition-colors ${
                        isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <tab.icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{tab.label}</span>
                    </button>
                  );
                })}

                {/* Theme toggle */}
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-foreground hover:bg-muted transition-colors"
                >
                  {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  <span className="text-sm font-medium">{isDark ? "Light Mode" : "Dark Mode"}</span>
                </button>

                {/* User info + logout */}
                <div className="border-t mt-2 pt-3">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <Avatar className="h-9 w-9 border">
                      <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                        {(user as any)?.name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{(user as any)?.name || "User"}</p>
                      <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
                    <span className="text-sm font-medium">Sign out</span>
                  </button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
}
