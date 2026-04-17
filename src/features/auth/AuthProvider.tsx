import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/types/crm";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  markOnboarded: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // If the user clicked a password reset link, redirect to the reset page
      // instead of logging them into the app
      if (event === "PASSWORD_RECOVERY") {
        setSession(session);
        setLoading(false);
        window.location.href = "/reset-password";
        return;
      }

      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error("Failed to fetch user profile:", error);
      setProfile(null);
    } else {
      setProfile(data as UserProfile);
    }
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  /**
   * Mark the signed-in user as having completed (or skipped) the welcome
   * wizard. Stamps user_profiles.onboarded_at so the wizard won't re-show
   * on next login, across browsers/devices. Previously this used
   * localStorage which meant clearing storage or using a new browser
   * popped the wizard again.
   */
  async function markOnboarded() {
    if (!session?.user?.id) return;
    const { error } = await supabase
      .from("user_profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", session.user.id);
    if (error) {
      console.error("Failed to mark onboarded:", error);
      return;
    }
    setProfile((prev) =>
      prev ? { ...prev, onboarded_at: new Date().toISOString() } : prev
    );
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signOut,
        markOnboarded,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
