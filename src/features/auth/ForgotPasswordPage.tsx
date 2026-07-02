import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PulseLogo } from "@/components/PulseLogo";
import {
  SeasonalBackdrop,
  getSeasonalScene,
  resolveSceneDate,
} from "@/components/seasonal/SeasonalBackdrop";

/**
 * Shared shell — seasonal backdrop + PulseLogo above the card, matching
 * the LoginPage treatment so the auth pages read as one family.
 */
function AuthShell({ children }: { children: React.ReactNode }) {
  // Resolve the scene once per mount (supports ?preview_date=YYYY-MM-DD).
  const scene = useMemo(() => getSeasonalScene(resolveSceneDate()), []);
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Seasonal backdrop — month-aware, decoration only. */}
      <SeasonalBackdrop scene={scene} />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-4 flex justify-center">
          <PulseLogo
            variant="login"
            tone={scene.dark ? "silver" : "graphite"}
            className="h-24 w-auto"
          />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="rounded-lg bg-green-50 dark:bg-green-950 p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Check your email for a password reset link. It may take a
                  minute to arrive.
                </p>
              </div>
              <Link
                to="/login"
                className="text-sm text-primary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@medcurity.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending..." : "Send Reset Link"}
              </Button>
              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
