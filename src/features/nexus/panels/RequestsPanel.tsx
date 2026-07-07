// Requests builder panel (jordan-v4-spec §4 step 7, §8): pick which
// request form the widget shows — one form, or all the forms you're routed
// to review. "All" is the reviewer's full inbox.

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { RequestsWidgetCategory, RequestsWidgetConfig } from "../types";

export function normalizeRequestsConfig(raw: unknown): RequestsWidgetConfig {
  const cfg = (raw ?? {}) as Partial<RequestsWidgetConfig>;
  return {
    category:
      cfg.category === "collateral" || cfg.category === "product" || cfg.category === "crm"
        ? cfg.category
        : "all",
  };
}

const OPTIONS: { value: RequestsWidgetCategory; label: string; hint: string }[] = [
  { value: "all", label: "All my forms", hint: "Every request form you're routed to review" },
  { value: "product", label: "Product", hint: "Product requests only" },
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
        Shows pending requests routed to you, with approve/deny. If you don't
        review any forms, it shows the requests you've submitted.
      </p>
    </div>
  );
}
