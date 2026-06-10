import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { branding } from "@/lib/branding";
import { PulseLogo } from "@/components/PulseLogo";
import { SeasonalBackdrop } from "@/components/seasonal/SeasonalBackdrop";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

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

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Seasonal backdrop — month-aware, decoration only. */}
      <SeasonalBackdrop />
      <Card className="relative z-10 w-full max-w-sm overflow-hidden shadow-xl">
        {/* Chrome wordmark on its dark stage; reflection fades into the
            banner's bottom edge. */}
        <div
          className="flex items-center justify-center px-6 py-3"
          style={{ background: "linear-gradient(180deg, #14181f 0%, #1b212d 100%)" }}
        >
          <PulseLogo variant="login" className="h-20 w-auto" />
        </div>
        <CardContent className="pt-5">
          <p className="mb-4 text-center text-sm text-muted-foreground">
            {branding.loginSubtitle}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@medcurity.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign In"}
            </Button>
            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-muted-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
