import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ClipboardCopy, ClipboardPaste, Download, ListChecks, Megaphone, Plus, Pencil, RotateCcw, Trash2, X, Search, UserPlus2, Snowflake, Sparkles,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import type { LeadList } from "@/types/crm";
import {
  useLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  useLeadListMembers,
  useLeadListMemberCount,
  useRemoveFromList,
  useBulkRemoveFromList,
  useSearchContactsForList,
  useBulkAddContactsToList,
  useSmartListMembers,
  useListExclusions,
  useRestoreToSmartList,
  useAddToSmartList,
  useExcludeFromSmartList,
  useFreezeSmartList,
  mqlSqlWindowDays,
  useActivateAccountsForContacts,
  parseSmartRules,
  smartRuleChips,
  smartRulesEmpty,
  type SmartListRules,
} from "./lead-lists-api";
import { MultiSelect } from "@/components/MultiSelect";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AddToListDialog } from "./AddToListDialog";
import { PastePeopleDialog } from "./PastePeopleDialog";
import { QuickCampaignDialog, type QuickCampaignContact } from "@/features/playbook/QuickCampaignDialog";
import { fetchRecipientsByList } from "@/features/playbook/api";
import { useTags } from "@/features/tags/api";
import { useUsers } from "@/features/accounts/api";
import { US_STATES } from "@/lib/us-states";
import { customerStatusLabel, formatPhoneWithExt } from "@/lib/formatters";
import type { CustomerStatus } from "@/types/crm";

/**
 * Lists — lives as the second tab of the Reports hub (Nathan 2026-07-20:
 * reports answer "who matches", lists are what you curate from them).
 * Regular lists are NEUTRAL — membership never touches status. Lists
 * flagged is_working_list (Summer's call lists) keep the 7/15 behavior:
 * membership drives accounts.sales_active (migration 20260720190000).
 */

export function ListsPage() {
  const { data: lists, isLoading, isError, isFetching, refetch } = useLeadLists();
  const { data: counts } = useLeadListMemberCount();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ?list=<id> deep link (the Nexus List widget's "Open list" footer).
  const [searchParams] = useSearchParams();
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    const target = searchParams.get("list");
    if (target) {
      deepLinked.current = true;
      setSelectedId(target);
    }
  }, [searchParams]);
  const [createOpen, setCreateOpen] = useState(false);
  // ?new=1 (the landing's New list button): arrive with the create dialog
  // already open. Ref-guarded like ?list so closing it doesn't re-trigger.
  const newLinked = useRef(false);
  useEffect(() => {
    if (newLinked.current) return;
    if (searchParams.get("new")) {
      newLinked.current = true;
      setCreateOpen(true);
    }
  }, [searchParams]);

  const selected = useMemo(
    () => lists?.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  // Two stages (Nathan 8/4: "lists should be chosen first, then open up in
  // a much more beautiful display"): a card gallery of lists, then the
  // chosen list takes the full width.
  if (selected) {
    return (
      <ListWorkspace
        key={selected.id}
        list={selected}
        onBack={() => setSelectedId(null)}
        onDeleted={() => setSelectedId(null)}
        onFrozen={(id) => setSelectedId(id)}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          A list is exactly what you put in it. Adding or removing people never
          changes their status; lists marked{" "}
          <span className="font-medium">working call list</span> are the
          exception and drive the account&apos;s Sales Status. Smart lists fill
          themselves from rules.
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New list
        </Button>
      </div>

      <CreateOrRenameListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <QueryError
          message="Couldn't load lists."
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      ) : !lists?.length ? (
        <EmptyState
          icon={ListChecks}
          title="No lists yet"
          description="Create a list here, or select contacts on the Contacts tab and use “Add to list”."
          action={{ label: "New list", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelectedId(l.id)}
              className="group flex flex-col rounded-xl border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start gap-2.5">
                <span className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
                  l.is_dynamic
                    ? "from-violet-500/20 to-violet-500/[0.05]"
                    : "from-sky-500/20 to-sky-500/[0.05]",
                )}>
                  {l.is_dynamic
                    ? <Sparkles className="h-4 w-4 text-violet-500" />
                    : <ListChecks className="h-4 w-4 text-sky-500" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug truncate">{l.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.is_dynamic && (
                      <Badge variant="outline" className="text-[10px]">
                        <Sparkles className="h-2.5 w-2.5 mr-1" /> Smart
                      </Badge>
                    )}
                    {l.is_working_list && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40">
                        Working call list
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {l.description && (
                <p className="mt-2 text-xs text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                  {l.description}
                </p>
              )}
              <p className="mt-auto pt-3 text-xs text-muted-foreground">
                {l.is_dynamic
                  ? "Fills itself from rules"
                  : `${(counts?.[l.id] ?? 0).toLocaleString()} ${(counts?.[l.id] ?? 0) === 1 ? "person" : "people"}`}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Plus className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium">New list</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── One workspace for both list kinds ────────────────────────────────

type SortKey = "name" | "account" | "email" | "phone";

function sortValue(r: WorkRow, key: SortKey): string {
  switch (key) {
    case "name":
      return `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    case "account":
      return r.account ?? "";
    case "email":
      return r.email ?? "";
    case "phone":
      return r.phone ?? "";
  }
}

function copyEmails(rows: WorkRow[]) {
  const emails = [...new Set(rows.map((r) => r.email?.trim()).filter((e): e is string => !!e))];
  if (!emails.length) {
    toast.info("No email addresses in that set");
    return;
  }
  void navigator.clipboard.writeText(emails.join(", ")).then(
    () => toast.success(`Copied ${emails.length} ${emails.length === 1 ? "email" : "emails"}`),
    () => toast.error("Couldn't reach the clipboard"),
  );
}

function exportCsv(listName: string, rows: WorkRow[]) {
  const table = [
    ["First name", "Last name", "Account", "Email", "Phone"],
    ...rows.map((r) => [r.firstName, r.lastName, r.account, r.email, r.phone]),
  ];
  downloadCsv(`${listName.replace(/[^\w-]+/g, "_") || "list"}.csv`, table);
  toast.success(`Exported ${rows.length} ${rows.length === 1 ? "row" : "rows"}`);
}

function SortHead({
  label,
  k,
  sort,
  onToggle,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onToggle: (k: SortKey) => void;
}) {
  const active = sort?.key === k;
  const Icon = active && sort ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={cn("flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", !active && "text-muted-foreground/50")} />
      </button>
    </TableHead>
  );
}

interface WorkRow {
  contactId: string;
  memberId: string | null; // static membership row when there is one
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  phoneExt: string | null;
  account: string | null;
}

function ListWorkspace({
  list,
  onBack,
  onDeleted,
  onFrozen,
}: {
  list: LeadList;
  onBack: () => void;
  onDeleted: () => void;
  onFrozen: (newListId: string) => void;
}) {
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const canWrite = ["sales", "renewals", "admin", "super_admin"].includes(role);

  const staticMembers = useLeadListMembers(list.is_dynamic ? undefined : list.id);
  const smartMembers = useSmartListMembers(list.is_dynamic ? list : null);
  const exclusions = useListExclusions(list.id, list.is_dynamic);

  const removeMutation = useRemoveFromList();
  const exclude = useExcludeFromSmartList();
  const restore = useRestoreToSmartList();
  const addSmart = useAddToSmartList();
  const bulkAdd = useBulkAddContactsToList();
  const deleteMutation = useDeleteLeadList();
  const freezeMutation = useFreezeSmartList();
  const activateAccounts = useActivateAccountsForContacts();
  const bulkRemove = useBulkRemoveFromList();

  const isLoading = list.is_dynamic ? smartMembers.isLoading : staticMembers.isLoading;

  const rows: WorkRow[] = useMemo(() => {
    if (list.is_dynamic) {
      const memberIdByContact = new Map(
        (staticMembers.data ?? [])
          .filter((m) => m.contact)
          .map((m) => [m.contact!.id, m.id] as const),
      );
      return (smartMembers.data?.rows ?? []).map((r) => ({
        contactId: r.id,
        memberId: memberIdByContact.get(r.id) ?? null,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        phoneExt: r.phone_ext,
        account: r.account?.name ?? null,
      }));
    }
    return (staticMembers.data ?? [])
      .filter((m) => m.contact)
      .map((m) => ({
        contactId: m.contact!.id,
        memberId: m.id,
        firstName: m.contact!.first_name,
        lastName: m.contact!.last_name,
        email: m.contact!.email,
        phone: m.contact!.phone,
        phoneExt: m.contact!.phone_ext,
        account: (m.contact as { account?: { name?: string } | null })?.account?.name ?? null,
      }));
  }, [list.is_dynamic, staticMembers.data, smartMembers.data]);

  // ACTIVE smart working list: additive Sales-Status reconcile (unchanged
  // behavior from the pre-rebuild page — on-only, never deactivates).
  const memberIdsKey = rows.map((r) => r.contactId).join(",");
  useEffect(() => {
    if (!list.is_dynamic || !canWrite || !list.is_working_list || !rows.length) return;
    activateAccounts.mutate(rows.map((r) => r.contactId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id, list.is_working_list, memberIdsKey]);

  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const { data: candidates } = useSearchContactsForList(search, list.id);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [campaignContacts, setCampaignContacts] = useState<QuickCampaignContact[] | null>(null);
  const [campaignGathering, setCampaignGathering] = useState(false);
  const [addToListIds, setAddToListIds] = useState<string[] | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(`pulse_list_sort:${list.id}`) ?? "null");
    } catch {
      return null;
    }
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);

  function rowsToCampaignContacts(source: WorkRow[]): QuickCampaignContact[] {
    return source.map((r) => ({
      id: r.contactId,
      first_name: r.firstName,
      last_name: r.lastName,
      email: r.email,
      account: r.account ? { name: r.account } : null,
    }));
  }

  async function startWholeListCampaign() {
    setCampaignGathering(true);
    try {
      const recipients = await fetchRecipientsByList(list);
      if (recipients.length > 10_000) {
        toast.error("This list has more than 10,000 email-ready people. Narrow it before starting a campaign.");
        return;
      }
      setCampaignContacts(recipients.map((r) => ({
        id: r.contact_id ?? r.email,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        email: r.email,
        account_id: r.account_id ?? null,
        account: r.company_name ? { name: r.company_name } : null,
      })));
    } catch (error) {
      toast.error("Couldn't gather this list: " + (error as Error).message);
    } finally {
      setCampaignGathering(false);
    }
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      const next =
        prev?.key !== key
          ? { key, dir: 1 as const }
          : prev.dir === 1
            ? { key, dir: -1 as const }
            : null;
      localStorage.setItem(`pulse_list_sort:${list.id}`, JSON.stringify(next));
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = !q
      ? [...rows]
      : rows.filter((r) =>
          [r.firstName, r.lastName, r.email, r.account]
            .map((v) => (v ?? "").toLowerCase())
            .some((v) => v.includes(q)),
        );
    if (sort) {
      out.sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (!va && !vb) return 0;
        if (!va) return 1; // empties sink regardless of direction
        if (!vb) return -1;
        return va.localeCompare(vb, undefined, { sensitivity: "base" }) * sort.dir;
      });
    }
    return out;
  }, [rows, filter, sort]);

  const shown = visible.slice(0, 500);
  const selectedRows = useMemo(
    () => rows.filter((r) => checked.has(r.contactId)),
    [rows, checked],
  );

  // Selection follows the data: ids that leave the list leave the selection.
  useEffect(() => {
    setChecked((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(rows.map((r) => r.contactId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  function removeRow(row: WorkRow) {
    if (list.is_dynamic) {
      // Sticky removal for smart lists; also drop a manual membership row
      // if one exists, so the hybrid union can't resurrect them.
      exclude.mutate({ listId: list.id, contactId: row.contactId });
      if (row.memberId) {
        removeMutation.mutate({ memberId: row.memberId, listId: list.id });
      }
    } else if (row.memberId) {
      removeMutation.mutate(
        { memberId: row.memberId, listId: list.id },
        { onSuccess: () => toast.success("Removed from list") },
      );
    }
  }

  async function addCandidate(contactId: string) {
    if (list.is_dynamic) {
      addSmart.mutate({ listId: list.id, contactId });
    } else {
      try {
        await bulkAdd.mutateAsync({ list_id: list.id, contact_ids: [contactId] });
        toast.success("Added to list");
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }

  const { data: tags } = useTags();
  const { data: users } = useUsers();
  const ruleChips = list.is_dynamic
    ? smartRuleChips(
        parseSmartRules(list),
        (id) => tags?.find((t) => t.id === id)?.name ?? "?",
        (id) => users?.find((u) => u.id === id)?.full_name ?? "?",
        (v) => customerStatusLabel(v as CustomerStatus),
      )
    : [];

  const removedRows = exclusions.data ?? [];

  return (
    <div className="space-y-4">
      {/* Stage-2 header: back + identity + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All lists
          </button>
          <h3 className="text-xl font-semibold tracking-tight flex flex-wrap items-center gap-2">
            {list.name}
            {list.is_dynamic && (
              <Badge variant="outline">
                <Sparkles className="h-3 w-3 mr-1" /> Smart list
              </Badge>
            )}
            {list.is_working_list && (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40">
                Working call list
              </Badge>
            )}
          </h3>
          {list.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{list.description}</p>
          )}
          {ruleChips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ruleChips.map((c) => (
                <Badge key={c} variant="secondary" className="font-normal">{c}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
              size="sm"
              className="gap-1.5"
              disabled={rows.length === 0 || campaignGathering}
              onClick={() => void startWholeListCampaign()}
            >
              <Megaphone className="h-4 w-4" />
              {campaignGathering ? "Gathering…" : "Start campaign"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />
            {list.is_dynamic ? "Edit rules" : "Rename"}
          </Button>
          {list.is_dynamic && (
            <Button
              variant="outline"
              size="sm"
              disabled={freezeMutation.isPending || rows.length === 0}
              onClick={() =>
                freezeMutation.mutate(list, {
                  onSuccess: (r) => {
                    toast.success(`Froze ${r.added.toLocaleString()} contacts into "${r.list.name}"`);
                    onFrozen(r.list.id);
                  },
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              <Snowflake className="h-4 w-4 mr-1" />
              {freezeMutation.isPending ? "Freezing…" : "Freeze"}
            </Button>
          )}
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              title="Paste emails or a CSV and match them into this list"
              onClick={() => setPasteOpen(true)}
            >
              <ClipboardPaste className="h-4 w-4 mr-1" />
              Paste people
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            title="Copy every email in the current view"
            onClick={() => copyEmails(visible)}
          >
            <ClipboardCopy className="h-4 w-4 mr-1" />
            Copy emails
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="Download the current view as a CSV"
            onClick={() => exportCsv(list.name, visible)}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Filter members + add people, side by side */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-52 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Filter ${rows.length.toLocaleString()} ${rows.length === 1 ? "person" : "people"}...`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="relative flex-1 min-w-52 max-w-sm">
          <UserPlus2 className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts to add..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
          {!!candidates?.length && (
            <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void addCandidate(c.id);
                    setSearch("");
                  }}
                >
                  <span className="truncate">
                    {c.first_name} {c.last_name}
                    {c.account?.name && (
                      <span className="text-muted-foreground"> · {c.account.name}</span>
                    )}
                  </span>
                  <UserPlus2 className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar — appears once anything is checked */}
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {checked.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddToListIds(selectedRows.map((r) => r.contactId))}
          >
            Add to another list…
          </Button>
          <Button
              variant="outline"
              size="sm"
              onClick={() => setCampaignContacts(rowsToCampaignContacts(selectedRows))}
            >
              <Megaphone className="h-4 w-4 mr-1" />
              Start a campaign…
          </Button>
          <Button variant="outline" size="sm" onClick={() => copyEmails(selectedRows)}>
            <ClipboardCopy className="h-4 w-4 mr-1" />
            Copy emails
          </Button>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={bulkRemove.isPending}
              onClick={() =>
                bulkRemove.mutate(
                  {
                    list,
                    contactIds: selectedRows.map((r) => r.contactId),
                    memberIds: selectedRows
                      .map((r) => r.memberId)
                      .filter((id): id is string => !!id),
                  },
                  { onSuccess: () => setChecked(new Set()) },
                )
              }
            >
              <X className="h-4 w-4 mr-1" />
              {list.is_dynamic ? "Remove and keep off" : "Remove from list"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setChecked(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* The people */}
      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {list.is_dynamic
            ? "Nobody matches the rules yet, and nobody has been added by hand. The moment someone matches, they appear here."
            : "No members yet. Search above, or select contacts on the Contacts tab and “Add to list”."}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          Nobody matches that filter.
        </div>
      ) : (
        <div className="border rounded-xl overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={shown.length > 0 && shown.every((r) => checked.has(r.contactId))}
                    onCheckedChange={(v) =>
                      setChecked(v ? new Set(shown.map((r) => r.contactId)) : new Set())
                    }
                    aria-label="Select everyone shown"
                  />
                </TableHead>
                <SortHead label="Name" k="name" sort={sort} onToggle={toggleSort} />
                <SortHead label="Account" k="account" sort={sort} onToggle={toggleSort} />
                <SortHead label="Email" k="email" sort={sort} onToggle={toggleSort} />
                <SortHead label="Phone" k="phone" sort={sort} onToggle={toggleSort} />
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <ContextMenu key={row.contactId}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      className={cn("group", checked.has(row.contactId) && "bg-muted/40")}
                    >
                      <TableCell className="w-8">
                        <Checkbox
                          checked={checked.has(row.contactId)}
                          onCheckedChange={() =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.contactId)) next.delete(row.contactId);
                              else next.add(row.contactId);
                              return next;
                            })
                          }
                          aria-label={`Select ${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/contacts/${row.contactId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.firstName} {row.lastName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{row.account ?? "\u2014"}</TableCell>
                      <TableCell className="text-sm">{row.email ?? "\u2014"}</TableCell>
                      <TableCell className="text-sm">
                        {row.phone ? formatPhoneWithExt(row.phone, row.phoneExt) : "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={list.is_dynamic ? "Remove and keep off" : "Remove from list"}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeRow(row)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem asChild>
                      <Link to={`/contacts/${row.contactId}`}>Open contact</Link>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setAddToListIds([row.contactId])}>
                      Add to another list…
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setCampaignContacts(rowsToCampaignContacts([row]))}>
                      Start a campaign…
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => removeRow(row)}
                    >
                      {list.is_dynamic ? "Remove and keep off" : "Remove from list"}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {visible.length > 500 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 500 of {visible.length.toLocaleString()}. Use the filter to narrow.
        </p>
      )}

      {/* Removed-and-kept-off, restorable (smart lists only) */}
      {list.is_dynamic && removedRows.length > 0 && (
        <div className="rounded-xl border p-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowRemoved((v) => !v)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {removedRows.length} removed and kept off
            <span className="text-xs">({showRemoved ? "hide" : "show"})</span>
          </button>
          {showRemoved && (
            <div className="mt-2 space-y-1">
              {removedRows.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <span className="min-w-0 truncate text-sm">
                    {ex.contact
                      ? `${ex.contact.first_name ?? ""} ${ex.contact.last_name ?? ""}`.trim() || "Unnamed"
                      : "Unknown contact"}
                    {ex.contact?.account?.name && (
                      <span className="text-muted-foreground"> · {ex.contact.account.name}</span>
                    )}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate({ exclusionId: ex.id, listId: list.id })}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {list.is_dynamic
          ? (list.is_working_list
              ? "Rule-driven and ACTIVE: matching contacts mark their accounts as actively worked (on-only). You can also add people by hand, and removals stick until you restore them."
              : "Rule-driven, plus anyone you add by hand. Removals stick until you restore them below. Never touches anyone's status.")
          : (list.is_working_list
              ? "Working call list: adding people marks their accounts as actively worked, and removing an account's last working-list contact switches it back."
              : "Regular list: adding or removing people never changes anyone's status.")}
      </p>

      <CreateOrRenameListDialog open={editOpen} onOpenChange={setEditOpen} existing={list} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${list.name}”?`}
        description={
          list.is_dynamic
            ? "The smart list's rules go away; the contacts themselves are untouched. This can't be undone."
            : list.is_working_list
              ? "The list and its memberships go away; the contacts themselves are untouched. Accounts this call list marked as actively-worked keep that status - review Sales Status if needed. This can't be undone."
              : "The list and its memberships go away; the contacts themselves are untouched. This can't be undone."
        }
        confirmLabel="Delete list"
        destructive
        onConfirm={() =>
          deleteMutation.mutate(list.id, {
            onSuccess: () => {
              toast.success("List deleted");
              onDeleted();
            },
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
      <PastePeopleDialog open={pasteOpen} onOpenChange={setPasteOpen} list={list} />
      {addToListIds && (
        <AddToListDialog
          open
          onOpenChange={(o) => {
            if (!o) setAddToListIds(null);
          }}
          contactIds={addToListIds}
        />
      )}
      {campaignContacts && (
        <QuickCampaignDialog
          open
          onOpenChange={(o) => {
            if (!o) setCampaignContacts(null);
          }}
          contacts={campaignContacts}
        />
      )}
    </div>
  );
}


type WindowUnit = "day" | "week" | "month" | "year";
const WINDOW_UNIT_DAYS: Record<WindowUnit, number> = { day: 1, week: 7, month: 30, year: 365 };

/** 120 days → {n: 4, unit: month}; picks the largest clean unit. */
function windowToParts(days: number | null): { n: number; unit: WindowUnit } {
  if (!days || days <= 0) return { n: 0, unit: "month" };
  if (days % 365 === 0) return { n: days / 365, unit: "year" };
  if (days % 30 === 0) return { n: days / 30, unit: "month" };
  if (days % 7 === 0) return { n: days / 7, unit: "week" };
  return { n: days, unit: "day" };
}

function CreateOrRenameListDialog({
  open,
  onOpenChange,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: LeadList;
  onCreated?: (id: string) => void;
}) {
  const { user } = useAuth();
  const createMutation = useCreateLeadList();
  const updateMutation = useUpdateLeadList();
  const { data: tags } = useTags();
  const { data: users } = useUsers();

  const existingRules: SmartListRules = existing?.is_dynamic
    ? parseSmartRules(existing)
    : {};

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [working, setWorking] = useState(existing?.is_working_list ?? false);
  const [smart, setSmart] = useState(existing?.is_dynamic ?? false);
  const [tagIds, setTagIds] = useState<string[]>(existingRules.tag_ids ?? []);
  const [states, setStates] = useState<string[]>(existingRules.states ?? []);
  const [ownerIds, setOwnerIds] = useState<string[]>(existingRules.owner_ids ?? []);
  const [statuses, setStatuses] = useState<string[]>(existingRules.customer_status ?? []);
  const [hasPhone, setHasPhone] = useState(!!existingRules.has_phone);
  const [hasEmail, setHasEmail] = useState(!!existingRules.has_email);
  const initialWindow = windowToParts(mqlSqlWindowDays(existingRules));
  const [mqlSqlN, setMqlSqlN] = useState<number>(initialWindow.n);
  const [mqlSqlUnit, setMqlSqlUnit] = useState<WindowUnit>(initialWindow.unit);

  // The dialog instance persists across opens (it isn't keyed/remounted), so
  // every field must re-initialize on open — otherwise the Working/Smart
  // toggles and rules leak from the previous creation into the next one, and
  // a list meant to be neutral silently becomes a status-flipping working list.
  useEffect(() => {
    if (!open) return;
    const r: SmartListRules = existing?.is_dynamic ? parseSmartRules(existing) : {};
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setWorking(existing?.is_working_list ?? false);
    setSmart(existing?.is_dynamic ?? false);
    setTagIds(r.tag_ids ?? []);
    setStates(r.states ?? []);
    setOwnerIds(r.owner_ids ?? []);
    setStatuses(r.customer_status ?? []);
    setHasPhone(!!r.has_phone);
    setHasEmail(!!r.has_email);
    const w = windowToParts(mqlSqlWindowDays(r));
    setMqlSqlN(w.n);
    setMqlSqlUnit(w.unit);
    // Reset only when the dialog OPENS — a background lists refetch while the
    // user is typing must not clobber their edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rules: SmartListRules = {
    tag_ids: tagIds.length ? tagIds : undefined,
    states: states.length ? states : undefined,
    owner_ids: ownerIds.length ? ownerIds : undefined,
    customer_status: statuses.length ? statuses : undefined,
    has_phone: hasPhone || undefined,
    has_email: hasEmail || undefined,
    mql_sql_within_days:
      mqlSqlN > 0 ? mqlSqlN * WINDOW_UNIT_DAYS[mqlSqlUnit] : undefined,
  };

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (smart && smartRulesEmpty(rules)) {
      toast.error("Pick at least one rule — an empty smart list would match everyone.");
      return;
    }
    try {
      if (existing) {
        await updateMutation.mutateAsync({
          id: existing.id,
          name: trimmed,
          description: description.trim() || null,
          is_working_list: working,
          ...(existing.is_dynamic ? { filter_config: rules as Record<string, unknown> } : {}),
        });
        toast.success("List updated");
      } else {
        if (!user?.id) return;
        const created = await createMutation.mutateAsync({
          name: trimmed,
          description: description.trim() || undefined,
          owner_user_id: user.id,
          is_dynamic: smart,
          is_working_list: working,
          filter_config: smart ? (rules as Record<string, unknown>) : null,
        });
        toast.success(smart ? "Smart list created" : "List created");
        onCreated?.(created.id);
        setName("");
        setDescription("");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? (existing.is_dynamic ? "Edit smart list" : "Rename list") : "New list"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? existing.is_dynamic
                ? "Change the rules — membership updates itself."
                : "Update the list's name or description."
              : "A list groups contacts however you like — by itself it never changes anyone's status."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. WA rural hospitals — Q3 calls"
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-desc">Description (optional)</Label>
            <Input
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {!existing && (
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Smart list
                </p>
                <p className="text-xs text-muted-foreground">
                  Rule-based and self-updating: tag someone (or they match the
                  rules) and they appear on it automatically. You can freeze it
                  into a regular list anytime.
                </p>
              </div>
              <Switch checked={smart} onCheckedChange={setSmart} />
            </div>
          )}

          {(smart || existing?.is_dynamic) && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Include contacts that match…
              </p>
              <div className="space-y-1.5">
                <Label>Any of these tags</Label>
                <MultiSelect
                  value={tagIds}
                  onChange={setTagIds}
                  placeholder="Any tag"
                  options={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <MultiSelect
                    value={states}
                    onChange={setStates}
                    placeholder="Any state"
                    options={US_STATES.map((st) => ({ value: st.code, label: st.name }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <MultiSelect
                    value={ownerIds}
                    onChange={setOwnerIds}
                    placeholder="Any owner"
                    options={(users ?? []).map((u) => ({ value: u.id, label: u.full_name ?? "Unknown" }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>New MQL or SQL within the last</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={mqlSqlN || ""}
                    placeholder="Off"
                    onChange={(e) => setMqlSqlN(Math.max(0, Number(e.target.value) || 0))}
                    className="w-24"
                  />
                  <Select value={mqlSqlUnit} onValueChange={(v) => setMqlSqlUnit(v as WindowUnit)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">days</SelectItem>
                      <SelectItem value="week">weeks</SelectItem>
                      <SelectItem value="month">months</SelectItem>
                      <SelectItem value="year">years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Any number works (4 days, 8 months, 1 year). Leave the number
                  empty to turn this rule off. Removing someone keeps them off
                  until you restore them.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Account status</Label>
                <MultiSelect
                  value={statuses}
                  onChange={setStatuses}
                  placeholder="Any status"
                  options={(["prospect", "client", "former_client"] as CustomerStatus[]).map((v) => ({
                    value: v,
                    label: customerStatusLabel(v),
                  }))}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={hasPhone} onCheckedChange={setHasPhone} />
                  Has a phone
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={hasEmail} onCheckedChange={setHasEmail} />
                  Has an email
                </label>
              </div>
            </div>
          )}

          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                {smart || existing?.is_dynamic ? "Active working list" : "Working call list"}
              </p>
              <p className="text-xs text-muted-foreground">
                {smart || existing?.is_dynamic
                  ? "On: contacts matching the rules mark their accounts as actively worked (applied when the list updates or is opened — it only ever turns accounts ON; dropping off the rules never deactivates anyone)."
                  : "On: adding people marks their accounts as actively worked (Sales Status). Off: just a list — nobody's status changes."}
              </p>
            </div>
            <Switch checked={working} onCheckedChange={setWorking} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
          >
            {existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
