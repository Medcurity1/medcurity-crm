import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  autoRetried: boolean;
}

// Errors we'll silently retry once automatically because they're almost
// always transient — a stale dynamic-import chunk after a deploy, a
// network glitch on a protected query, or a lazy-loaded route that lost
// its code-split chunk. Brayden reported "URL paths sometimes error and
// then work after refresh" — that's the chunk-load class of failures.
function isTransientError(err: Error | null): boolean {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("chunkloaderror") ||
    msg.includes("importing a module script failed") ||
    msg.includes("networkerror") ||
    msg.includes("load failed")
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, autoRetried: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, autoRetried: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);

    // Auto-retry once for transient chunk-load / network errors. Reset
    // state after a short tick so the boundary re-renders its children.
    if (isTransientError(error) && !this.state.autoRetried) {
      this.setState({ autoRetried: true });
      setTimeout(() => {
        this.setState({ hasError: false, error: null });
      }, 250);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground text-center max-w-md">
            {this.state.error?.message || "An unexpected error occurred while rendering this page."}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() =>
                this.setState({ hasError: false, error: null, autoRetried: false })
              }
            >
              Try Again
            </Button>
            <Button onClick={() => window.location.href = "/"}>
              Go Home
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
