// List widget (Summer via Nathan, 2026-08-04): one of your lead lists as
// widget rows, so working a list happens on Nexus instead of a detour to
// Reports. Static lists show their members; SMART lists resolve their
// rule live minus sticky exclusions. The X on each row is the workflow:
// worked it, remove it, it stays gone (exclusion for smart lists, member
// delete for static ones). Rows-shown = the scroll window's height, same
// contract as the Requests widget.

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, ExternalLink, Sparkles, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import {
  fetchListExclusionIds,
  parseSmartRules,
  smartRulesEmpty,
  buildSmartQuery,
  useExcludeFromSmartList,
  useRemoveFromList,
} from "@/features/lead-lists/lead-lists-api";
import type { LeadList } from "@/types/crm";
import type { ListWidgetConfig } from "../types";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

interface ListRowData {
  contactId: string;
  /** lead_list_members.id for static rows; null for smart rows. */
  memberId: string | null;
  name: string;
  account: string | null;
}

function useListWidgetData(listId: string | null) {
  return useQuery({
    queryKey: ["nexus-widget-data", "list", listId],
    enabled: !!listId,
    queryFn: async () => {
      const { data: list, error: listErr } = await supabase
        .from("lead_lists")
        .select("id, name, description, owner_user_id, is_dynamic, filter_config, created_at, updated_at")
        .eq("id", listId!)
        .maybeSingle();
      if (listErr) throw listErr;
      if (!list) return { list: null, rows: [] as ListRowData[] };

      if (list.is_dynamic) {
        const rules = parseSmartRules(list as LeadList);
        if (smartRulesEmpty(rules)) return { list: list as LeadList, rows: [] };
        const [excluded, res, manual] = await Promise.all([
          fetchListExclusionIds(list.id),
          buildSmartQuery(
            rules,
            "id, first_name, last_name, account:accounts!account_id(name)",
          )
            .order("last_name", { ascending: true, nullsFirst: false })
            .limit(500),
          supabase
            .from("lead_list_members")
            .select("contact:contacts(id, first_name, last_name, account:accounts!account_id(name))")
            .eq("list_id", list.id)
            .not("contact_id", "is", null),
        ]);
        if (res.error) throw res.error;
        const seen = new Set<string>();
        const rows: ListRowData[] = [];
        // Hand-added members first (hybrid smart lists, Nathan 8/4).
        for (const m of (manual.data ?? []) as unknown as Array<{
          contact: { id: string; first_name: string | null; last_name: string | null; account: { name: string } | null } | null;
        }>) {
          if (!m.contact || seen.has(m.contact.id) || excluded.has(m.contact.id)) continue;
          seen.add(m.contact.id);
          rows.push({
            contactId: m.contact.id,
            memberId: null,
            name: [m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ") || "Unnamed",
            account: m.contact.account?.name ?? null,
          });
        }
        for (const raw of (res.data ?? []) as unknown as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          account: { name: string } | null;
        }>) {
          if (seen.has(raw.id) || excluded.has(raw.id)) continue;
          seen.add(raw.id);
          rows.push({
            contactId: raw.id,
            memberId: null,
            name: [raw.first_name, raw.last_name].filter(Boolean).join(" ") || "Unnamed",
            account: raw.account?.name ?? null,
          });
        }
        return { list: list as LeadList, rows };
      }

      const { data: members, error: memErr } = await supabase
        .from("lead_list_members")
        .select("id, contact:contacts(id, first_name, last_name, account:accounts!account_id(name))")
        .eq("list_id", list.id)
        .not("contact_id", "is", null)
        .order("added_at", { ascending: false })
        .limit(500);
      if (memErr) throw memErr;
      const rows: ListRowData[] = [];
      for (const m of (members ?? []) as unknown as Array<{
        id: string;
        contact: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          account: { name: string } | null;
        } | null;
      }>) {
        if (!m.contact) continue;
        rows.push({
          contactId: m.contact.id,
          memberId: m.id,
          name:
            [m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ") ||
            "Unnamed",
          account: m.contact.account?.name ?? null,
        });
      }
      return { list: list as LeadList, rows };
    },
  });
}

export function ListWidget({ widget, searchQuery, onDataUpdated }: NexusWidgetBodyProps) {
  const config = (widget.config ?? {}) as Partial<ListWidgetConfig>;
  const listId = config.list_id ?? null;
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useListWidgetData(listId);
  const exclude = useExcludeFromSmartList();
  const removeMember = useRemoveFromList();
  const qc = useQueryClient();
  // useRemoveFromList predates this widget and invalidates only the Lists
  // page keys — refresh this widget's own query so the row leaves the
  // screen the moment it leaves the list.
  const refreshSelf = () =>
    qc.invalidateQueries({ queryKey: ["nexus-widget-data", "list"] });

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  const q = searchQuery.trim().toLowerCase();
  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.account ?? ""].some((s) => s.toLowerCase().includes(q)),
    );
  }, [data?.rows, q]);

  if (!listId) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Pick a list in this widget's settings (the pencil above).
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load this list."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!data?.list) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        This list was deleted. Pick another in the widget settings.
      </p>
    );
  }

  const overflowing = visible.length > widget.preview_count;

  return (
    <div>
      {data.list.is_dynamic && (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          Smart list: updates itself. Removing someone keeps them off.
        </p>
      )}
      {visible.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {q ? "No rows match your filter." : "Nobody on this list right now."}
        </p>
      ) : (
        <div
          className="space-y-1 overflow-y-auto pr-1"
          style={{ maxHeight: widget.preview_count * 44 }}
        >
          {visible.map((row) => (
            <div
              key={row.contactId}
              className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/contacts/${row.contactId}`}
                  className="block truncate text-sm font-medium hover:text-primary hover:underline"
                >
                  {row.name}
                </Link>
                {row.account && (
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{row.account}</span>
                  </p>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Remove ${row.name} from this list`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                    onClick={() => {
                      if (data.list!.is_dynamic) {
                        exclude.mutate({ listId: data.list!.id, contactId: row.contactId });
                      } else if (row.memberId) {
                        removeMember.mutate(
                          { memberId: row.memberId, listId: data.list!.id },
                          { onSuccess: refreshSelf },
                        );
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {data.list.is_dynamic
                    ? "Worked it: remove and keep off"
                    : "Remove from list"}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
        <span>
          {data.rows.length} on the list{overflowing ? " · scroll for the rest" : ""}
        </span>
        <Link
          to={`/reports?tab=lists&list=${data.list.id}`}
          className="flex items-center gap-1 hover:text-primary hover:underline"
        >
          Open list <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
