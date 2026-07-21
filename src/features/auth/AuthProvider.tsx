import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import type { UserProfile } from "@/types/crm";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  // True when the profile row failed to LOAD (network/auth blip), as opposed
  // to genuinely not existing. Drives a recoverable "Reload" screen instead of
  // the terminal "Account Not Provisioned" dead-end.
  profileError: boolean;
  signOut: () => Promise<void>;
  markOnboarded: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  // The user id whose profile is currently loaded. Lets us skip the
  // loading/re-fetch when an auth event resolves to the same user (e.g. a
  // sibling tab syncing a refreshed session in), avoiding a screen flash.
  const loadedUserId = useRef<string | null>(null);
  // The user id of an in-flight profile fetch. Boot fires two profile loads
  // for the same user (getSession().then and the INITIAL_SESSION auth event
  // both land before loadedUserId is set); this dedups the concurrent pair.
  const inFlightProfileFetch = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        // Without this, a getSession failure (e.g. storage blocked) left
        // loading=true forever → infinite "Loading..." spinner. Treat as
        // signed-out; the login page is a better dead end than a spinner.
        console.error("getSession failed at boot:", err);
        setLoading(false);
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
        // A token refresh can complete right after a window where in-flight
        // requests went out with a stale/anon token and came back failed OR
        // silently empty (RLS returns an empty set, not an error). Refetch
        // everything so those queries recover without a full browser refresh.
        // Deliberately NOT done for INITIAL_SESSION (boot) — queries mount
        // fresh there, so invalidating would double-fetch the whole app.
        if (event === "TOKEN_REFRESHED") {
          queryClient.invalidateQueries();
        }

        // Routine token refreshes (and user-updated events) fire with the
        // profile already loaded — don't re-enter the loading state for
        // those, or the whole app would blank for a moment every ~hour.
        // For an actual sign-in we DO re-enter loading while the profile
        // fetches, otherwise there's a brief render with a session but no
        // profile yet, which flashed the "Account Not Provisioned" screen.
        if (
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED" ||
          session.user.id === loadedUserId.current
        )
          return;

        // A genuine sign-in (new/changed user) — same recovery rationale as
        // the token-refresh case above. A same-user SIGNED_IN re-fire (e.g.
        // window focus) already returned above, so this can't flood refetches.
        if (event === "SIGNED_IN") {
          queryClient.invalidateQueries();
        }

        setLoading(true);
        fetchProfile(session.user.id);
      } else {
        loadedUserId.current = null;
        setProfile(null);
        setProfileError(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    // Dedup the two concurrent boot-time loads for the same user (see
    // inFlightProfileFetch). The first call runs; the second bails early and
    // lets the first flip loading/profile.
    if (inFlightProfileFetch.current === userId) return;
    inFlightProfileFetch.current = userId;

    // Separate "no profile row exists" (a genuinely un-provisioned account —
    // permanent, needs an admin) from "couldn't load the profile row" (a
    // transient network/auth blip). Collapsing both into profile=null (the old
    // behavior) stranded users on the terminal "Account Not Provisioned"
    // Sign-Out dead-end after a boot-time network hiccup, with a full browser
    // refresh the only escape. Now: the missing-row case shows that screen;
    // a load failure is retried, then surfaces a recoverable "Reload" screen.
    //
    // try/finally: a THROWN failure (network drop — supabase-js rejects, it
    // doesn't return an error object for those) must still flip loading off,
    // or the app strands on the loading screen.
    const MAX_ATTEMPTS = 3;
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { data, error } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", userId)
            .single();

          if (data) {
            loadedUserId.current = userId;
            setProfile(data as UserProfile);
            setProfileError(false);
            return;
          }

          // PGRST116 = .single() matched no row → genuinely un-provisioned.
          // Not retryable; there is no profile to load.
          if (error?.code === "PGRST116") {
            loadedUserId.current = null;
            setProfile(null);
            setProfileError(false);
            return;
          }

          // Any other error object is treated as transient → fall through
          // to the backoff/retry below.
          console.error(
            `Failed to fetch user profile (attempt ${attempt}/${MAX_ATTEMPTS}):`,
            error
          );
        } catch (err) {
          // Thrown rejection (network drop) — also transient, retry.
          console.error(
            `Failed to fetch user profile (attempt ${attempt}/${MAX_ATTEMPTS}):`,
            err
          );
        }

        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }

      // Retries exhausted on a transient failure. Do NOT null the profile into
      // the "Account Not Provisioned" dead-end — expose a recoverable error so
      // ProtectedRoute can offer a Reload instead of only Sign Out.
      loadedUserId.current = null;
      setProfileError(true);
    } finally {
      inFlightProfileFetch.current = null;
      setLoading(false);
    }
  }

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    loadedUserId.current = null;
    setSession(null);
    setProfile(null);
    setProfileError(false);
  }, []);

  /**
   * Mark the signed-in user as having completed (or skipped) the welcome
   * wizard. Stamps user_profiles.onboarded_at so the wizard won't re-show
   * on next login, across browsers/devices. Previously this used
   * localStorage which meant clearing storage or using a new browser
   * popped the wizard again.
   */
  const markOnboarded = useCallback(async () => {
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
  }, [session]);

  // Memoize so useAuth consumers (AppLayout, every list, Sidebar, AdminGate)
  // don't re-render on an unrelated parent render — only when auth state
  // actually changes. signOut/markOnboarded are stable via useCallback.
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileError,
      signOut,
      markOnboarded,
    }),
    [session, profile, loading, profileError, signOut, markOnboarded]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
