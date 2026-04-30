import * as React from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Small inline help affordance: renders a 12px ⓘ icon next to a field label.
 * Hovering (or focusing via keyboard) for ~500ms reveals the help text in a
 * tooltip. If `text` is empty / null / whitespace, NOTHING renders — no icon,
 * no whitespace, no listeners. The label looks identical to a label with no
 * help configured.
 *
 * Designed for the Page Layout system's `help_text` per-field column. Admins
 * edit help text in Object Manager → Layouts → field gear; everyone else just
 * sees the hover affordance.
 */
export interface HelpTooltipProps {
  text?: string | null;
  className?: string;
  /** Override the default 500ms reveal delay. */
  delayMs?: number;
  /** Tooltip side. Default "top". */
  side?: "top" | "right" | "bottom" | "left";
}

export function HelpTooltip({
  text,
  className,
  delayMs = 500,
  side = "top",
}: HelpTooltipProps) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  return (
    <TooltipProvider delayDuration={delayMs}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Field help"
            className={cn(
              "inline-flex items-center justify-center text-muted-foreground/70",
              "hover:text-foreground focus-visible:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "rounded-full transition-colors",
              className,
            )}
            // Prevent the help icon from submitting forms or triggering label
            // click handlers on its parent.
            onClick={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs whitespace-pre-line">
          {trimmed}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
