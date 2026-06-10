import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { RequestType } from "@/types/crm";
import { useUsers } from "@/features/leads/api";
import {
  REQUEST_TYPE_LABELS,
  useRequestRouting,
  useAddRouting,
  useRemoveRouting,
} from "./api";

const TYPES: RequestType[] = ["collateral", "product", "crm"];

interface UserLite {
  id: string;
  full_name: string | null;
}

function AddRecipient({
  available,
  onAdd,
}: {
  available: UserLite[];
  onAdd: (userId: string) => void;
}) {
  const [val, setVal] = useState("");
  if (available.length === 0) return null;
  return (
    <Select
      value={val}
      onValueChange={(v) => {
        onAdd(v);
        setVal("");
      }}
    >
      <SelectTrigger className="h-7 w-[160px] text-xs">
        <SelectValue placeholder="+ Add person" />
      </SelectTrigger>
      <SelectContent>
        {available.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.full_name ?? "Unnamed user"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Admin control for who receives + works each request type. Stored by
 * user id in request_routing, so it never depends on a name string.
 */
export function RoutingEditor() {
  const { data: routing } = useRequestRouting();
  const { data: users } = useUsers();
  const add = useAddRouting();
  const remove = useRemoveRouting();

  return (
    <div className="space-y-3">
      {TYPES.map((type) => {
        const recips = (routing ?? []).filter((r) => r.type === type);
        const assigned = new Set(recips.map((r) => r.user_id));
        const available = ((users ?? []) as UserLite[]).filter(
          (u) => !assigned.has(u.id),
        );
        return (
          <div key={type} className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold">
              {REQUEST_TYPE_LABELS[type]} requests
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {recips.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  No recipients yet
                </span>
              )}
              {recips.map((r) => (
                <Badge key={r.user_id} variant="secondary" className="gap-1 pr-1">
                  {r.user?.full_name ?? "Unknown"}
                  <button
                    type="button"
                    aria-label="Remove"
                    className="rounded p-0.5 hover:bg-background/60"
                    onClick={() =>
                      remove.mutate(
                        { type, userId: r.user_id },
                        { onError: (e) => toast.error((e as Error).message) },
                      )
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <AddRecipient
                available={available}
                onAdd={(userId) =>
                  add.mutate(
                    { type, userId },
                    { onError: (e) => toast.error((e as Error).message) },
                  )
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
