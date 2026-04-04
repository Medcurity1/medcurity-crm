import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold mb-2">404</h1>
      <p className="text-muted-foreground mb-6">Page not found</p>
      <Button asChild>
        <Link to="/accounts">Go to Accounts</Link>
      </Button>
    </div>
  );
}
