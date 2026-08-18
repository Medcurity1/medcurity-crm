import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

// Matches the single-record undo on OpportunityDetail — long enough to
// realize a bulk action hit the wrong selection and react to it.
const UNDO_DURATION = 10_000;

export type UndoEntity = "accounts" | "contacts" | "opportunities";

// The query keys each entity's forward archive / owner mutation already
// invalidates (accounts/api.ts, contacts/api.ts, opportunities/api.ts).
// An undo has to refresh the same caches or the list keeps showing the
// state the undo just reverted.
const INVALIDATE_KEYS: Record<UndoEntity, string[][]> = {
  accounts: [["accounts"], ["account-contacts"]],
  contacts: [["contacts"], ["account-contacts"]],
  opportunities: [["opportunities"], ["pipeline"], ["renewal_queue"]],
};

const CHUNK = 100;

export type PriorOwner = { id: string; owner_user_id: string | null };

type OwnedRow = { id: string; owner_user_id?: string | null };

/**
 * Prior owners for `ids`, read from the rows the list already holds.
 *
 * Returns null when any id is missing from `rows`: selection survives
 * paging, so a selection can outlive the page it was made on, and a
 * revert that silently skipped the rows it couldn't see would be worse
 * than no undo at all. Callers drop the Undo action in that case.
 */
export function capturePriorOwners(
  ids: string[],
  rows: OwnedRow[] | undefined,
): PriorOwner[] | null {
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const prior: PriorOwner[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return null;
    prior.push({ id, owner_user_id: row.owner_user_id ?? null });
  }
  return prior;
}

/** Ids grouped by the owner they must be written back to, so a revert is
 *  one UPDATE per distinct prior owner (null — unassigned — included)
 *  rather than one per row. */
export function groupByPriorOwner(prior: PriorOwner[]): Map<string | null, string[]> {
  const byOwner = new Map<string | null, string[]>();
  for (const { id, owner_user_id } of prior) {
    const ids = byOwner.get(owner_user_id);
    if (ids) ids.push(id);
    else byOwner.set(owner_user_id, [id]);
  }
  return byOwner;
}

async function restoreArchived(entity: UndoEntity, ids: string[]) {
  // Same RPC the Archive Manager restores with — it nulls archived_at,
  // archived_by and archive_reason, the exact three columns
  // archive_record sets. Server-side it is admin-only, which matches the
  // bulk Archive button (admin-gated on all three lists).
  await Promise.all(
    ids.map(async (id) => {
      const { error } = await supabase.rpc("restore_record", {
        target_table: entity,
        target_id: id,
      });
      if (error) throw error;
    }),
  );
}

async function restorePriorOwners(entity: UndoEntity, prior: PriorOwner[]) {
  let updated = 0;
  for (const [owner, ids] of groupByPriorOwner(prior)) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from(entity)
        .update({ owner_user_id: owner })
        .in("id", batch)
        .select("id");
      if (error) throw error;
      updated += (data ?? []).length;
    }
  }
  // Same affected-row verify the forward bulk update does: a per-row RLS
  // denial doesn't throw, PostgREST just doesn't match the row.
  if (updated < prior.length) {
    throw new Error(
      `Reverted ${updated} of ${prior.length}. ${prior.length - updated} could not be updated (permission denied or no longer exist).`,
    );
  }
}

/**
 * Success toasts carrying an Undo for the bulk archive / bulk owner
 * change on the accounts, contacts and opportunities lists.
 *
 * `noun` is the already-pluralized label the list uses in its own toasts
 * ("account(s)", "opportunity(ies)") so the wording doesn't drift.
 */
export function useBulkUndo(entity: UndoEntity, noun: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    for (const key of INVALIDATE_KEYS[entity]) qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["archived", entity] });
  };

  return {
    archived(ids: string[]) {
      toast.success(`${ids.length} ${noun} archived.`, {
        duration: UNDO_DURATION,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await restoreArchived(entity, ids);
              invalidate();
              toast.success(`Restored ${ids.length} ${noun}`);
            } catch (e) {
              toast.error("Failed to undo: " + (e as Error).message);
            }
          },
        },
      });
    },

    /** `prior` null => the pre-change owners couldn't all be captured, so
     *  the toast goes up without an Undo rather than a partial one. */
    reassigned(count: number, prior: PriorOwner[] | null) {
      toast.success(`${count} ${noun} reassigned.`, {
        duration: prior ? UNDO_DURATION : undefined,
        action: prior
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await restorePriorOwners(entity, prior);
                  invalidate();
                  toast.success(`Owner reverted on ${prior.length} ${noun}`);
                } catch (e) {
                  toast.error("Failed to undo: " + (e as Error).message);
                }
              },
            }
          : undefined,
      });
    },
  };
}
