import { activityTitleForDisplay } from "@/features/activities/activity-display";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hidePromptCopy } from "./day-queue";
import type { DayQueueRow } from "./day-queue-api";

export function DayQueueHideDialog({
  row,
  open,
  onOpenChange,
  onStopItem,
  onStopCategory,
  onKeep,
  busy,
}: {
  row: DayQueueRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStopItem: () => void;
  onStopCategory: () => void;
  onKeep: () => void;
  busy?: boolean;
}) {
  if (!row) return null;
  const copy = hidePromptCopy(row);
  const title = activityTitleForDisplay(row.title) || "This reminder";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-4 p-5 sm:max-w-sm"
        aria-describedby="day-queue-hide-desc"
      >
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {copy.title}
          </DialogTitle>
          <DialogDescription id="day-queue-hide-desc" className="text-sm">
            {copy.body}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 px-3 py-2.5 dark:bg-muted/20">
          <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
          {row.reason && (
            <p className="mt-0.5 text-xs text-muted-foreground">{row.reason}</p>
          )}
        </div>

        {copy.hint && (
          <p className="text-xs text-muted-foreground">{copy.hint}</p>
        )}

        <div className="flex flex-col gap-2">
          <Button type="button" className="w-full" onClick={onStopItem} disabled={busy}>
            {copy.stopItemLabel}
          </Button>
          {copy.stopCategoryLabel && (
            <Button
              type="button"
              className="w-full"
              variant="outline"
              onClick={onStopCategory}
              disabled={busy}
            >
              {copy.stopCategoryLabel}
            </Button>
          )}
          <Button
            type="button"
            className="w-full text-muted-foreground"
            variant="ghost"
            onClick={onKeep}
            disabled={busy}
          >
            {copy.keepLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
