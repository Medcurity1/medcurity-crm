import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { crossTabStorage } from "./crossTabSession";

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Session lives in per-tab sessionStorage (mirrored across tabs by
    // crossTabSession) so closing the last tab / shutting down logs the user
    // out, while extra open tabs keep them in. Falls back to localStorage when
    // BroadcastChannel is unavailable. See crossTabSession.ts.
    storage: crossTabStorage,
  },
});
