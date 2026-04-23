import { useState } from "react";
import { Check, CircleDashed } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/formatters";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

type VerifiableTable = "accounts" | "contacts" | "opportunities" | "leads";

/**
 * Small badge + toggle shown next to record names during and after
 * the Salesforce migration. Verified = "I've confirmed this record's
 * data matches what was in SF (or is otherwise correct)."
 *
 * Click toggles on/off for admins and the record's owner; anyone
 * else sees a read-only badge.
 */
export function VerifiedBadge({
  table,
  recordId,
  verified,
  verifiedAt,
  verifierName,
  ownerId,
  size = "sm",
  invalidateKeys = [],
}: {
  table: VerifiableTable;
  recordId: string;
  verified: boolean;
  verifiedAt?: string | null;
  verifierName?: string | null;
  /** owner_user_id on the record — owner + admins can toggle. */
  ownerId?: string | null;
  size?: "sm" | "md";
  /** Extra query keys to invalidate after toggling (e.g. detail query). */
  invalidateKeys?: string[][];
}) {
  const { profile, user } = useAuth();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isOwner = !!user && !!ownerId && ownerId === user.id;
  const canToggle = isAdmin || isOwner;

  async function handleToggle() {
    if (!canToggle || loading) return;
    setLoading(true);
    try {
      const next = !verified;
      const payload: Record<string, unknown> = {
        verified: next,
        verified_at: next ? new Date().toISOString() : null,
        verified_by: next ? user?.id ?? null : null,
      };
      const { error } = await supabase.from(table).update(payload).eq("id", recordId);
      if (error) throw error;
      toast.success(next ? "Marked verified" : "Unmarked verified");
      // Invalidate the list + detail + any extra keys the caller wants
      qc.invalidateQueries({ queryKey: [table] });
      qc.invalidateQueries({ queryKey: [table.slice(0, -1)] }); // "account", "contact", etc.
      for (const k of invalidateKeys) {
        qc.invalidateQueries({ queryKey: k });
      }
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const title = verified
    ? verifiedAt
      ? `Verified ${formatDateTime(verifiedAt)}${verifierName ? ` by ${verifierName}` : ""}`
      : "Verified"
    : "Not verified — confirm the data here matches SF before cutover";

  const sizeClass = size === "md" ? "h-6 px-2 text-xs" : "h-5 px-1.5 text-[10px]";
  const iconClass = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  const content = (
    <Button
      type="button"
      variant={verified ? "secondary" : "outline"}
      className={cn(
        "gap-1 font-medium",
        sizeClass,
        verified
          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200"
          : "text-muted-foreground hover:text-foreground",
        !canToggle && "pointer-events-none"
      )}
      disabled={loading || !canToggle}
      onClick={handleToggle}
      aria-label={verified ? "Verified" : "Not verified"}
    >
      {verified ? <Check className={iconClass} /> : <CircleDashed className={iconClass} />}
      {verified ? "Verified" : "Unverified"}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="max-w-xs text-xs">{title}</p>
      </TooltipContent>
    </Tooltip>
  );
}
