import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  onArchive?: () => void;
  onAssignOwner?: (userId: string) => void;
  users?: { id: string; full_name: string | null }[];
}

export function BulkActionBar({
  selectedCount,
  onClear,
  onArchive,
  onAssignOwner,
  users,
}: BulkActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3 shadow-lg transition-transform duration-200 sm:gap-3 sm:px-6",
        selectedCount > 0 ? "translate-y-0" : "translate-y-full"
      )}
    >
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>

      {onAssignOwner && users && users.length > 0 && (
        <Select onValueChange={(val) => onAssignOwner(val)}>
          <SelectTrigger className="w-40 sm:w-48">
            <SelectValue placeholder="Assign Owner" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? "Unnamed"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {onArchive && (
        <Button variant="destructive" size="sm" onClick={onArchive}>
          Archive
        </Button>
      )}

      <Button variant="ghost" size="icon" onClick={onClear} className="ml-auto">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
