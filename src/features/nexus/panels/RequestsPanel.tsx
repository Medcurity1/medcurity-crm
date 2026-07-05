// Requests builder panel (jordan-v4-spec §4 step 7, §8): pick which
// request category the widget shows — Collateral only, CRM only, or all
// pending requests the widget owner has submitted.

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { RequestsWidgetCategory, RequestsWidgetConfig } from "../types";

export function normalizeRequestsConfig(raw: unknown): RequestsWidgetConfig {
  const cfg = (raw ?? {}) as Partial<RequestsWidgetConfig>;
  return {
    category:
      cfg.category === "collateral" || cfg.category === "crm"
        ? cfg.category
        : "all",
  };
}

const OPTIONS: { value: RequestsWidgetCategory; label: string; hint: string }[] = [
  { value: "all", label: "All Requests", hint: "Collateral, CRM, and product requests" },
  { value: "collateral", label: "Collateral", hint: "Collateral requests only" },
  { value: "crm", label: "CRM", hint: "CRM change requests only" },
];

export function RequestsPanel({
  config: rawConfig,
  onConfigChange,
}: {
  config: unknown;
  onConfigChange: (config: RequestsWidgetConfig) => void;
}) {
  const config = normalizeRequestsConfig(rawConfig);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <Label>Show</Label>
      <div className="space-y-1.5" role="radiogroup" aria-label="Request category">
        {OPTIONS.map((opt) => {
          const selected = config.category === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onConfigChange({ category: opt.value })}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-primary" : "border-input",
                )}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Shows pending requests submitted by the page owner.
      </p>
    </div>
  );
}
