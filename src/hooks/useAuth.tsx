import { useState, useEffect, useContext, createContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type Profile = {
  name: string;
  email: string;
};

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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("name, email")
              .eq("user_id", session.user.id)
              .maybeSingle();
            setUser({
              ...session.user,
              name: profile?.name || session.user.user_metadata?.name || "",
            });
          } catch {
            setUser(session.user);
          }
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("name, email")
            .eq("user_id", session.user.id)
            .maybeSingle();
          setUser({
            ...session.user,
            name: profile?.name || session.user.user_metadata?.name || "",
          });
        } catch {
          setUser(session.user);
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, []);

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
