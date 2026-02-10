import { useState, useEffect, useContext, createContext, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: (User & { name?: string }) | null;
  session: Session | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<(User & { name?: string }) | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Safety timeout: force loading off after 5s
  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(timeout);
  }, [loading]);

  // Non-blocking profile fetch — updates user.name when ready
  const fetchProfile = useCallback((authUser: User) => {
    supabase
      .from("profiles")
      .select("name")
      .eq("user_id", authUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) {
          setUser((prev) =>
            prev && prev.id === authUser.id
              ? { ...prev, name: data.name }
              : prev
          );
        }
      }, () => {});
  }, []);

  useEffect(() => {
    let isMounted = true;

    // 1. Set up listener FIRST — synchronous updates only
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!isMounted) return;
        setSession(newSession);
        if (newSession?.user) {
          const authUser = newSession.user;
          setUser({
            ...authUser,
            name: authUser.user_metadata?.name || "",
          });
          // Fire profile fetch non-blocking (setTimeout avoids Supabase deadlock)
          setTimeout(() => fetchProfile(authUser), 0);
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    );

    // 2. Then get initial session
    supabase.auth.getSession().then(async ({ data: { session: initial } }) => {
      if (!isMounted) return;
      setSession(initial);
      if (initial?.user) {
        const authUser = initial.user;
        let name = authUser.user_metadata?.name || "";
        try {
          const { data } = await supabase
            .from("profiles")
            .select("name")
            .eq("user_id", authUser.id)
            .maybeSingle();
          if (data?.name) name = data.name;
        } catch {}
        if (isMounted) {
          setUser({ ...authUser, name });
        }
      }
      if (isMounted) setLoading(false);
    }).catch(() => {
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
