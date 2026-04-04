import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Webhook } from "lucide-react";

export function WebhooksManager() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Webhooks</h3>
          <p className="text-sm text-muted-foreground">
            Receive real-time notifications when events occur in your CRM.
          </p>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="sm" disabled>
                Add Webhook
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming Soon</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <Webhook className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">
          No webhooks configured yet.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Webhooks allow external services to send data to your CRM in
          real-time.
        </p>
      </div>
    </div>
  );
}
