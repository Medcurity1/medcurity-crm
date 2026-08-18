import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * "Export CSV" toolbar button shared by the Accounts / Contacts /
 * Opportunities lists.
 *
 * Owns only the interaction shell — in-flight state, the error toast,
 * and the selection-aware label. WHAT gets exported is the caller's job
 * (each list knows its own filters and visible columns).
 *
 * The label changes when rows are selected because the behavior changes
 * with it: a selection narrows the export to just those rows, and that
 * has to be visible BEFORE the click, not discovered afterwards in the
 * file.
 */
export function ExportCsvButton({
  onExport,
  selectedCount = 0,
  disabled,
}: {
  onExport: () => Promise<void>;
  selectedCount?: number;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport();
    } catch (e) {
      toast.error("Export failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label =
    selectedCount > 0 ? `Export ${selectedCount} selected` : "Export CSV";

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy || disabled}
      title={
        selectedCount > 0
          ? "Download the selected rows, with the columns you have visible"
          : "Download every row matching the current filters, with the columns you have visible"
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {busy ? "Exporting…" : label}
    </Button>
  );
}
