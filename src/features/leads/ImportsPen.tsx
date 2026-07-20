import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plus, Upload, Ban, UserCheck, Archive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUsers } from "@/features/accounts/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { BulkActionBar } from "@/components/BulkActionBar";
import { MultiSelect } from "@/components/MultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Search } from "lucide-react";
import { formatPhone } from "@/components/PhoneInput";
import { leadSourceLabel } from "@/lib/formatters";
import type { LeadSource } from "@/types/crm";
import { ContactImportWizard } from "@/features/contacts/import/ContactImportWizard";
import { BulkArchiveFromFile } from "./BulkArchiveFromFile";
import { BulkPromoteFromFile } from "./BulkPromoteFromFile";
import { useArchiveAllPendingImports } from "./api";

/**
 * Imports pen v2 — the pen is CONTACTS with import_status='pending'
 * (lead-type retirement pieces 3+4, docs/imports-tab-plan.md), not rows in
 * the legacy `leads` table. Raw lists land here via the Import wizard in
 * pen mode; promoting resolves the account from the raw company string and
 * clears the flag; Avoid/Archive set the row aside. Pending rows are hidden
 * from the normal Contacts surfaces until promoted.
 *
 * The LEGACY strip below the stats appears only while the old leads-table
 * pile still has pending rows: it keeps the one-time sweep + the old
 * file-based tools reachable until that pile is emptied, so nothing is
 * ever stranded invisible.
 */

interface PenRow {
  id: string;
  first_name: string | null;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  import_company: string | null;
  lead_source: LeadSource | null;
  created_at: string;
  owner: { id: string; full_name: string | null } | null;
}

interface PromoteResult {
  promoted: number;
  skipped_duplicate: number;
  skipped_ambiguous: number;
  skipped_other: number;
  errors: number;
  promoted_ambiguous_accountless: number;
}

function usePendingImports(opts: {
  search: string;
  ownerFilter: string[];
  page: number;
  pageSize: number;
}) {
  const { search, ownerFilter, page, pageSize } = opts;
  const { user } = useAuth();
  return useQuery({
    queryKey: ["imports-pen", "list", { search, ownerFilter, page, pageSize }],
    queryFn: async () => {
      let q = supabase
        .from("contacts")
        .select(
          "id, first_name, last_name, email, phone, title, import_company, lead_source, created_at, owner:user_profiles!owner_user_id(id, full_name)",
          { count: "exact" },
        )
        .eq("import_status", "pending")
        .is("archived_at", null);
      const s = search.trim();
      if (s) {
        const esc = s.replace(/[%_,()]/g, " ").trim();
        if (esc) {
          q = q.or(
            `first_name.ilike.%${esc}%,last_name.ilike.%${esc}%,email.ilike.%${esc}%,import_company.ilike.%${esc}%`,
          );
        }
      }
      if (ownerFilter.length > 0) {
        const ids = ownerFilter.map((v) => (v === "mine" ? user?.id : v)).filter(Boolean);
        if (ids.length > 0) q = q.in("owner_user_id", ids as string[]);
      }
      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as PenRow[], count: count ?? 0 };
    },
  });
}

function usePenStats() {
  return useQuery({
    queryKey: ["imports-pen", "stats"],
    queryFn: async () => {
      const [pending, promoted, archived, legacy] = await Promise.all([
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("import_status", "pending")
          .is("archived_at", null),
        // Promoted-through-the-pen: flag cleared, provenance kept.
        // (import_company is the provenance marker, so companyless promotes
        // aren't counted here — cosmetic undercount, acceptable.)
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .not("import_company", "is", null)
          .is("import_status", null)
          .is("archived_at", null),
        // Archived pen rows KEEP import_status='pending' (only promote
        // clears it), which is what identifies them here — import_company
        // can't (companyless rows like a blank-company avoid have none).
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("import_status", "pending")
          .not("archived_at", "is", null),
        // Legacy old-pen pile (the leads table) awaiting the one-time sweep.
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null),
      ]);
      for (const r of [pending, promoted, archived, legacy]) {
        if (r.error) throw r.error;
      }
      return {
        pending: pending.count ?? 0,
        promoted: promoted.count ?? 0,
        archived: archived.count ?? 0,
        legacy: legacy.count ?? 0,
      };
    },
  });
}

function usePromotePending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { ids: string[]; allowAmbiguousAccountless?: boolean }) => {
      const { data, error } = await supabase.rpc("promote_pending_imports", {
        p_ids: args.ids,
        p_promote_ambiguous_accountless: args.allowAmbiguousAccountless ?? false,
      });
      if (error) throw error;
      return data as PromoteResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imports-pen"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

function useArchivePending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { ids: string[]; reason: string; markDoNotContact?: boolean }) => {
      const { data, error } = await supabase.rpc("archive_pending_imports", {
        p_ids: args.ids,
        p_reason: args.reason,
        p_mark_do_not_contact: args.markDoNotContact ?? false,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["imports-pen"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{(value ?? 0).toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

export function ImportsPen() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: users } = useUsers();

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [legacyPromoteOpen, setLegacyPromoteOpen] = useState(false);
  const [legacyArchiveOpen, setLegacyArchiveOpen] = useState(false);
  // One shared in-app confirmation for every destructive bulk action
  // (in-app instead of window.confirm: consistent with the rest of Pulse).
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    run: () => Promise<void>;
  }>(null);

  const { data, isLoading, isError, refetch, isFetching } = usePendingImports({
    search, ownerFilter, page, pageSize,
  });
  const { data: stats } = usePenStats();
  const promoteMutation = usePromotePending();
  const archiveMutation = useArchivePending();
  const legacySweep = useArchiveAllPendingImports();

  const rows = data?.rows ?? [];
  const totalCount = data?.count ?? 0;
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  if (!isAdmin) return <Navigate to="/accounts" replace />;

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });

  const promoteToastParts = (r: PromoteResult) => {
    const parts = [`${r.promoted} promoted`];
    if (r.promoted_ambiguous_accountless)
      parts.push(`${r.promoted_ambiguous_accountless} promoted without an account (multiple matched)`);
    if (r.skipped_ambiguous) parts.push(`${r.skipped_ambiguous} left pending (multiple accounts matched)`);
    if (r.skipped_other) parts.push(`${r.skipped_other} skipped (no longer pending)`);
    if (r.errors) parts.push(`${r.errors} error(s)`);
    return parts.join(" · ");
  };

  const handlePromote = () => {
    const ids = Array.from(selectedIds);
    setConfirmAction({
      title: `Promote ${ids.length} import(s) to Contacts?`,
      description:
        "Each one is matched to an existing account by company name (or a new account is created). " +
        "Rows whose company matches multiple accounts stay pending — you'll be offered a follow-up " +
        "to promote those without an account.",
      confirmLabel: "Promote",
      run: async () => {
        try {
          const r = await promoteMutation.mutateAsync({ ids });
          toast.success(promoteToastParts(r));
          setSelectedIds(new Set());
          if (r.skipped_ambiguous > 0) {
            setConfirmAction({
              title: `${r.skipped_ambiguous} matched multiple accounts`,
              description:
                "Their company name matches more than one account, so they were left pending " +
                "rather than guessing. Promote them now WITHOUT an account? You can attach the " +
                "right account on each contact afterwards.",
              confirmLabel: "Promote without account",
              run: async () => {
                try {
                  const r2 = await promoteMutation.mutateAsync({ ids, allowAmbiguousAccountless: true });
                  toast.success(promoteToastParts(r2));
                } catch (e) {
                  toast.error((e as Error).message);
                }
              },
            });
          }
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
  };

  const handleAvoid = (reason: string, label: string) => {
    const ids = Array.from(selectedIds);
    setConfirmAction({
      title: `Mark ${ids.length} import(s) as Avoid (${label})?`,
      description:
        "They'll be archived and flagged Do Not Contact so they're never marketed to again.",
      confirmLabel: "Mark Avoid",
      destructive: true,
      run: async () => {
        try {
          const n = await archiveMutation.mutateAsync({
            ids, reason: `avoid: ${reason}`, markDoNotContact: true,
          });
          setSelectedIds(new Set());
          toast.success(`${n} marked Avoid and archived`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
  };

  const handleArchive = () => {
    const ids = Array.from(selectedIds);
    setConfirmAction({
      title: `Archive ${ids.length} import(s)?`,
      description: "They're set aside (restorable by an admin) and stay out of Contacts.",
      confirmLabel: "Archive",
      destructive: true,
      run: async () => {
        try {
          const n = await archiveMutation.mutateAsync({ ids, reason: "import cleanup" });
          setSelectedIds(new Set());
          toast.success(`${n} import(s) archived`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
  };

  const handleLegacySweep = () => {
    const n = stats?.legacy ?? 0;
    setConfirmAction({
      title: `Archive all ${n.toLocaleString()} legacy import rows?`,
      description:
        "The one-time sweep of the old pre-cutover pile (everything not yet promoted). " +
        "Archived rows stay restorable from the Archive tab.",
      confirmLabel: "Archive all",
      destructive: true,
      run: async () => {
        try {
          const count = await legacySweep.mutateAsync("lead-type retirement: legacy pile sweep");
          toast.success(`${count.toLocaleString()} legacy row(s) archived`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="Imports"
        description="Raw lists land here. Clean them up, promote the good ones to Contacts, archive the rest."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setWizardOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Import a list
            </Button>
            <Button variant="outline" onClick={() => navigate("/contacts/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add one
            </Button>
          </div>
        }
      />

      <ContactImportWizard open={wizardOpen} onOpenChange={setWizardOpen} penMode />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard label="Pending" value={stats?.pending} />
        <StatCard label="Promoted to Contacts" value={stats?.promoted} />
        <StatCard label="Archived" value={stats?.archived} />
      </div>

      {(stats?.legacy ?? 0) > 0 && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 flex flex-wrap items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm">
              <span className="font-medium">{(stats?.legacy ?? 0).toLocaleString()} legacy import rows</span>{" "}
              from before the cutover are still pending in the old system.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" variant="outline" onClick={() => setLegacyPromoteOpen(true)}>
                Bulk promote from file
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLegacyArchiveOpen(true)}>
                Bulk archive from file
              </Button>
              <Button size="sm" onClick={handleLegacySweep} disabled={legacySweep.isPending}>
                <Archive className="h-4 w-4 mr-1" />
                {legacySweep.isPending ? "Archiving…" : "Archive all legacy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <BulkPromoteFromFile open={legacyPromoteOpen} onOpenChange={setLegacyPromoteOpen} />
      <BulkArchiveFromFile open={legacyArchiveOpen} onOpenChange={setLegacyArchiveOpen} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search imports..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-8"
          />
        </div>
        <MultiSelect
          value={ownerFilter}
          onChange={(v) => { setOwnerFilter(v); setPage(0); }}
          placeholder="All Owners"
          triggerClassName="w-40"
          options={[
            { value: "mine", label: "My Imports" },
            ...(users ?? []).map((u) => ({ value: u.id, label: u.full_name ?? "Unknown" })),
          ]}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load imports"
          description="Something went wrong loading this list. This is usually a momentary hiccup — try again."
        >
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No pending imports"
          description={
            search || ownerFilter.length > 0
              ? "Try adjusting your search or filters"
              : "Import a list to get started — new rows land here for cleanup."
          }
          action={
            !search && ownerFilter.length === 0
              ? { label: "Import a list", onClick: () => setWizardOpen(true) }
              : undefined
          }
        />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/contacts/${r.id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleSelect(r.id)}
                        aria-label={`Select ${r.first_name ?? ""} ${r.last_name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/contacts/${r.id}`}
                        className="font-medium text-primary hover:underline block truncate"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.first_name} {r.last_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="truncate" title={r.import_company ?? ""}>
                        {r.import_company ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.lead_source ? (
                        <StatusBadge
                          value={r.lead_source}
                          variant="leadSource"
                          label={leadSourceLabel(r.lead_source)}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="truncate" title={r.email ?? ""}>{r.email ?? "—"}</div>
                    </TableCell>
                    <TableCell>{r.phone ? formatPhone(r.phone) : "—"}</TableCell>
                    <TableCell>
                      <div className="truncate">{r.owner?.full_name ?? "Unassigned"}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
          />
        </>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => { if (!o) setConfirmAction(null); }}
        title={confirmAction?.title ?? ""}
        description={confirmAction?.description ?? ""}
        confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
        destructive={confirmAction?.destructive ?? false}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (a) void a.run();
        }}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
      >
        <Button size="sm" onClick={handlePromote} disabled={promoteMutation.isPending}>
          <UserCheck className="h-4 w-4 mr-1" />
          {promoteMutation.isPending ? "Promoting…" : "Promote to Contacts"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={archiveMutation.isPending}>
              <Ban className="h-4 w-4 mr-1" />
              Mark Avoid
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {([
              ["bounced", "Bounced"],
              ["unsubscribed", "Unsubscribed"],
              ["auto_reply", "Auto-reply"],
              ["manual", "Other / manual"],
            ] as const).map(([val, label]) => (
              <DropdownMenuItem key={val} onSelect={() => handleAvoid(val, label)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={handleArchive} disabled={archiveMutation.isPending}>
          <Archive className="h-4 w-4 mr-1" />
          Archive
        </Button>
      </BulkActionBar>
    </div>
  );
}
