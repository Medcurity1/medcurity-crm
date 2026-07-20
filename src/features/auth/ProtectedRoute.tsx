import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui/button";

export function ProtectedRoute() {
  const { session, loading, profile, signOut } = useAuth();

  // Escape hatch: auth resolution normally takes well under a second. If
  // it's wedged (Safari has hung here on a stuck cross-tab lock), offer a
  // way out instead of an infinite spinner.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(t);
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
        {slow && (
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              This is taking longer than it should.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("_r", String(Date.now()));
                window.location.replace(url.toString());
              }}
            >
              Reload
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-xl font-semibold">Account Not Provisioned</h2>
          <p className="text-muted-foreground">
            Your login works, but you don't have a CRM profile yet. Ask an admin
            to create your user profile.
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            User ID: {session.user.id}
          </p>
          <Button variant="outline" onClick={() => signOut()}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  // A deactivated profile still has a valid session token, so without this
  // check a departed/disabled user would land in the app shell (every CRM
  // query would come back empty because RLS — current_app_role()/is_admin()
  // — already requires is_active, but the broken-but-loaded UI is confusing
  // and a poor signal). Reject cleanly with a clear message instead.
  if (profile.is_active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-xl font-semibold">Account Deactivated</h2>
          <p className="text-muted-foreground">
            Your account has been deactivated. If you think this is a mistake,
            contact a Medcurity admin to have it re-enabled.
          </p>
          <Button variant="outline" onClick={() => signOut()}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
