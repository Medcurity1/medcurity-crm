// Shared load-error block for the Playbook list tabs, so a failed fetch
// shows a clear error + retry instead of masquerading as an empty list.

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
      <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
      <p className="text-sm font-medium">Couldn't load {what}.</p>
      <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}
