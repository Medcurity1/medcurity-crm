import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared "this didn't load" state. Several screens previously showed a blank
 * area (or stale data) when a query failed, with no way to recover without a
 * full page reload. Drop this in the `isError` branch with the query's
 * `refetch` so the user gets a clear message + a one-click Retry.
 */
export function QueryError({
  message = "Something went wrong loading this.",
  onRetry,
  isRetrying,
  compact,
}: {
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
          : "flex flex-col items-center justify-center gap-3 py-12 text-center"
      }
    >
      <div className={compact ? "flex items-center gap-2 text-destructive" : "flex flex-col items-center gap-2"}>
        <AlertCircle className={compact ? "h-4 w-4 shrink-0" : "h-8 w-8 text-destructive"} />
        <p className={compact ? "" : "text-sm text-muted-foreground max-w-sm"}>{message}</p>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
          className="gap-1.5 shrink-0"
        >
          <RefreshCw className={"h-3.5 w-3.5" + (isRetrying ? " animate-spin" : "")} />
          Retry
        </Button>
      )}
    </div>
  );
}
