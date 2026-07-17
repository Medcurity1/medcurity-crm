import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const REASON_PRESETS = [
  "Duplicate record",
  "Closed business",
  "Bad / test data",
  "Other",
];

/**
 * Archive confirmation with a required reason (Summer's duplicate-cleanup
 * request, 2026-07-17). Non-admin archives are rejected by the DB without
 * a reason; requiring it for everyone keeps the archive log auditable.
 * The final reason is "<preset>: <detail>" when detail is given.
 */
export function ArchiveDialog({
  open,
  onOpenChange,
  entityLabel,
  onArchive,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** "Account" | "Contact" — used in the title/copy. */
  entityLabel: string;
  onArchive: (reason: string) => void;
  pending?: boolean;
}) {
  const [preset, setPreset] = useState("");
  const [detail, setDetail] = useState("");

  function reset() {
    setPreset("");
    setDetail("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive {entityLabel}</DialogTitle>
          <DialogDescription>
            This hides the {entityLabel.toLowerCase()} from active views —
            nothing is deleted, and an admin can restore it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger>
                <SelectValue placeholder="Why is this being archived?" />
              </SelectTrigger>
              <SelectContent>
                {REASON_PRESETS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="archive-detail">Details (optional)</Label>
            <Input
              id="archive-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder='e.g. "Duplicate of Mercy Health — kept the other record"'
              maxLength={300}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!preset || pending}
            onClick={() => {
              const reason = detail.trim()
                ? `${preset}: ${detail.trim()}`
                : preset;
              onArchive(reason);
            }}
          >
            {pending ? "Archiving..." : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
