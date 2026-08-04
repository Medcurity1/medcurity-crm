// The Collateral page (Jordan's 2026-08-04 change request; admin-only at
// launch — flipping to sales is a config change on collateral_settings
// plus moving the sidebar entry). The same library component also mounts
// as a tab on contact and deal records.

import { useMemo, useState } from "react";
import { FolderOpen, MessageSquarePlus, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useRequestDialog } from "@/features/requests/RequestDialogProvider";
import { CollateralLibrary } from "./CollateralLibrary";
import { CollateralItemDialog } from "./CollateralItemDialog";
import { useCollateralItems, useSyncCollateral, type CollateralItem } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";

export function CollateralPage() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(
    ((profile as { role?: string } | null)?.role ?? ""),
  );
  const { openRequestDialog } = useRequestDialog();
  const { data: items } = useCollateralItems();
  const sync = useSyncCollateral();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CollateralItem | null>(null);

  const known = useMemo(() => {
    const all = items ?? [];
    const uniq = (vals: string[]) => [...new Set(vals.filter(Boolean))];
    return {
      assetTypes: uniq(all.map((i) => i.asset_type ?? "")),
      products: uniq(all.flatMap((i) => i.products)),
      segments: uniq(all.flatMap((i) => i.segments)),
      uses: uniq(all.flatMap((i) => i.uses)),
    };
  }, [items]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Collateral"
          description="Find the right asset and copy its link without leaving Pulse."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => openRequestDialog("collateral")}
          >
            <MessageSquarePlus className="h-4 w-4" />
            Request collateral
          </Button>
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <RefreshCw className={sync.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {sync.isPending ? "Syncing..." : "Sync SharePoint"}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add asset
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        <CollateralLibrary
          onEdit={(item) => {
            setEditing(item);
            setDialogOpen(true);
          }}
        />
      </div>

      {isAdmin && (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" />
          Assets live in the SharePoint Sales Collateral library. Pulse mirrors
          them here so reps can search, filter, and copy links mid-call.
        </p>
      )}

      <CollateralItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        knownAssetTypes={known.assetTypes}
        knownProducts={known.products}
        knownSegments={known.segments}
        knownUses={known.uses}
      />
    </div>
  );
}
