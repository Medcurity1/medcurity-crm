// Shared error state for Nexus widget bodies. Distinct from the empty
// state ("No tasks due today") so a failed query reads as a failure the
// user can retry, not as "you have nothing". Kept intentionally compact —
// widgets live at half page width.

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WidgetError({
  message = "Couldn't load this widget.",
  onRetry,
  isRetrying,
}: {
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 py-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
    </div>
  );
}
