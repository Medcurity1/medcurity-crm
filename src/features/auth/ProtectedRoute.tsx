import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function ProtectedRoute() {
  const { session, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
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
        </div>
      </div>
    );
  }

  return <Outlet />;
}
