import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { branding } from "@/lib/branding";
import { PulseLogo } from "@/components/PulseLogo";
import {
  SeasonalBackdrop,
  getSeasonalScene,
  resolveSceneDate,
} from "@/components/seasonal/SeasonalBackdrop";
import { useAuth } from "./AuthProvider";

/**
 * Floating login — no card. The form sits directly on the seasonal
 * backdrop and its colors adapt to the scene (light text on dark scenes,
 * dark text on light ones) so everything stays readable year-round.
 */
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  // Resolve the scene once per mount (supports ?preview_date=YYYY-MM-DD).
  const scene = useMemo(() => getSeasonalScene(resolveSceneDate()), []);
  const dark = scene.dark;

  // Scene preview (?preview_date=...) stays viewable even while signed
  // in, so seasonal backdrops can be toured without logging out.
  const previewingScene = new URLSearchParams(window.location.search).has(
    "preview_date",
  );

  // Render-safe redirect. The previous navigate()-during-render could be
  // silently dropped by React Router, leaving a permanently blank page
  // for signed-in users landing on /login.
  if (session && !previewingScene) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      navigate("/", { replace: true });
    }
  }

  const labelCls = dark ? "text-white/85" : "text-slate-800";
  const inputCls = dark
    ? "border-white/25 bg-white/10 text-white placeholder:text-white/40 focus-visible:ring-white/50"
    : "border-slate-900/25 bg-white/60 text-slate-900 placeholder:text-slate-500 focus-visible:ring-slate-500/40";

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Seasonal backdrop — month-aware, decoration only. */}
      <SeasonalBackdrop scene={scene} />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-1 flex justify-center">
          <PulseLogo
            variant="login"
            tone={dark ? "silver" : "graphite"}
            className="h-24 w-auto"
          />
        </div>
        <p className={cn("mb-6 text-center text-sm", dark ? "text-white/65" : "text-slate-600")}>
          {branding.loginSubtitle}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className={labelCls}>
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@medcurity.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className={inputCls}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className={labelCls}>
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          {error && (
            <p className={cn("text-sm", dark ? "text-red-300" : "text-destructive")}>
              {error}
            </p>
          )}
          <Button type="submit" className="w-full shadow-lg" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
          <div className="text-center">
            <Link
              to="/forgot-password"
              className={cn(
                "text-sm hover:underline",
                dark ? "text-white/60 hover:text-white" : "text-slate-600 hover:text-slate-900",
              )}
            >
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
