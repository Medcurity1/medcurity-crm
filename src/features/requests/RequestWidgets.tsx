import { Palette, Package, Wrench } from "lucide-react";
import type { RequestType } from "@/types/crm";
import { useMyRequestTypes, useRequests, REQUEST_TYPE_LABELS } from "./api";
import { RequestCard } from "./RequestCard";

const TYPE_ICON: Record<RequestType, typeof Palette> = {
  collateral: Palette,
  product: Package,
  crm: Wrench,
};

function TypeBox({ type }: { type: RequestType }) {
  const { data, isLoading } = useRequests({ type, pendingOnly: true });
  const Icon = TYPE_ICON[type];
  const items = data ?? [];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{REQUEST_TYPE_LABELS[type]} requests</h3>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {items.length}
        </span>
      </div>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          All clear — nothing pending.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The per-user request boxes shown on Nexus. Renders only the types the
 * current user is routed to (from request_routing): collateral/CRM for
 * Jordan + Nathan, product for Rachel + Nathan. Returns null for users
 * with no routed types.
 */
export function NexusRequestWidgets() {
  const { data: myTypes } = useMyRequestTypes();
  if (!myTypes || myTypes.length === 0) return null;

  const order: RequestType[] = ["collateral", "product", "crm"];
  const types = order.filter((t) => myTypes.includes(t));
  if (types.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Your requests</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {types.map((t) => (
          <TypeBox key={t} type={t} />
        ))}
      </div>
    </div>
  );
}
