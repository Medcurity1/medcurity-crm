// Admin "Data Cleanup" tab. Two jobs, both about duplicates:
//   1. Duplicate accounts → merge them (move everything onto one, archive the
//      rest, with an Undo).
//   2. Leads that duplicate an existing contact → retire the stray lead.
//   3. A history of past merges, each with an Undo.
//
// Everything here is admin-only (the page already gates to admins, and every
// RPC re-checks server-side). Copy is deliberately plain — no jargon — and
// every destructive action says exactly what moves and what gets archived
// before it runs. Nothing is ever hard-deleted.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Undo2,
  Users,
  Briefcase,
} from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import {
  useLeadContactDuplicates,
  useLeadDuplicateCounts,
  useArchiveLeadAsDuplicate,
  useAccountDuplicateGroups,
  useMergeAccounts,
  useAccountMergeHistory,
  useUndoAccountMerge,
  type DuplicateTier,
  type AccountDuplicateGroupRow,
  type LeadContactDuplicate,
} from "./data-cleanup-api";

type Section = "accounts" | "leads" | "history";

export function DataCleanupManager() {
  const [section, setSection] = useState<Section>("accounts");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SectionButton active={section === "accounts"} onClick={() => setSection("accounts")}>
          Duplicate accounts
        </SectionButton>
        <SectionButton active={section === "leads"} onClick={() => setSection("leads")}>
          Leads that match a contact
        </SectionButton>
        <SectionButton active={section === "history"} onClick={() => setSection("history")}>
          Merge history
        </SectionButton>
      </div>

      {section === "accounts" && <AccountDuplicatesPanel />}
      {section === "leads" && <LeadDuplicatesPanel />}
      {section === "history" && <MergeHistoryPanel />}
    </div>
  );
}

function SectionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

/* ============================ Duplicate accounts ============================ */

function AccountDuplicatesPanel() {
  const { data: rows, isLoading, isError, error } = useAccountDuplicateGroups();
  const mergeMutation = useMergeAccounts();

  // Which account is the "keeper" per group (defaults to the first row, which
  // the finder already orders as the strongest survivor candidate).
  const [survivorByGroup, setSurvivorByGroup] = useState<Record<string, string>>({});
  // The group currently in the confirm dialog.
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, AccountDuplicateGroupRow[]>();
    for (const r of rows ?? []) {
      const list = map.get(r.group_key) ?? [];
      list.push(r);
      map.set(r.group_key, list);
    }
    return Array.from(map.entries());
  }, [rows]);

  function survivorFor(groupKey: string, list: AccountDuplicateGroupRow[]) {
    return survivorByGroup[groupKey] ?? list[0]?.account_id ?? "";
  }

  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message={(error as Error)?.message} />;
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-6 w-6 text-green-600" />}
        title="No duplicate accounts found"
        body="Every account has a unique company name. Nothing to merge right now."
      />
    );
  }

  const confirmList = confirmGroup
    ? (groups.find(([k]) => k === confirmGroup)?.[1] ?? [])
    : [];
  const confirmSurvivorId = confirmGroup ? survivorFor(confirmGroup, confirmList) : "";
  const confirmSurvivor = confirmList.find((r) => r.account_id === confirmSurvivorId);
  const confirmLosers = confirmList.filter((r) => r.account_id !== confirmSurvivorId);
  const movedContacts = confirmLosers.reduce((s, r) => s + r.contact_count, 0);
  const movedOpps = confirmLosers.reduce((s, r) => s + r.opportunity_count, 0);

  function runMerge() {
    if (!confirmGroup || !confirmSurvivor) return;
    const survivorId = confirmSurvivor.account_id;
    const loserIds = confirmLosers.map((r) => r.account_id);
    const groupKey = confirmGroup;
    setConfirmGroup(null);
    mergeMutation.mutate(
      { survivorId, loserIds, reason: `Merged duplicates of "${groupKey}"` },
      {
        onSuccess: (res) => {
          toast.success(
            `Merged ${res.losers_archived} account${res.losers_archived === 1 ? "" : "s"} into ${confirmSurvivor!.name}.`,
            { description: `${res.rows_reparented} records moved. You can undo this from Merge history.` }
          );
        },
        onError: (err: Error) =>
          toast.error("Merge failed", { description: err.message }),
      }
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        These accounts look like the same company. Pick the one to keep, then merge
        the others into it — all their contacts, opportunities, activities, and files
        move over, and the duplicates are archived (not deleted, so you can undo).
      </p>

      {groups.map(([groupKey, list]) => {
        const survivorId = survivorFor(groupKey, list);
        return (
          <Card key={groupKey} className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {list.length} accounts that look like the same company
              </div>
              <Button
                size="sm"
                onClick={() => setConfirmGroup(groupKey)}
                disabled={mergeMutation.isPending}
              >
                Review &amp; merge {list.length - 1} into the kept one
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Keep?</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Contacts</TableHead>
                    <TableHead className="text-right">Opps</TableHead>
                    <TableHead className="text-right">Won $</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => {
                    const isSurvivor = r.account_id === survivorId;
                    return (
                      <TableRow key={r.account_id} className={isSurvivor ? "bg-green-50 dark:bg-green-950/20" : ""}>
                        <TableCell>
                          {isSurvivor ? (
                            <Badge className="bg-green-600 hover:bg-green-600">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Keep
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                setSurvivorByGroup((p) => ({ ...p, [groupKey]: r.account_id }))
                              }
                            >
                              Keep this one
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            to={`/accounts/${r.account_id}`}
                            target="_blank"
                            className="font-medium text-primary hover:underline"
                          >
                            {r.name}
                          </Link>
                          {r.account_number && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              #{r.account_number}
                            </span>
                          )}
                          {r.has_closed_won && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              Has won deal
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="capitalize text-sm">
                          {r.lifecycle_status ?? r.account_status ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{r.owner_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.contact_count}</TableCell>
                        <TableCell className="text-right">{r.opportunity_count}</TableCell>
                        <TableCell className="text-right">
                          {r.total_won_amount ? formatCurrency(r.total_won_amount) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.last_activity_at ? fmtDate(r.last_activity_at) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        );
      })}

      {/* Merge confirm — the crucial clarity moment. */}
      <AlertDialog open={!!confirmGroup} onOpenChange={(o) => !o && setConfirmGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge these accounts?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
                  <span className="font-medium text-green-800 dark:text-green-200">
                    Keep:
                  </span>{" "}
                  {confirmSurvivor?.name}
                  {confirmSurvivor?.account_number && (
                    <span className="text-muted-foreground"> #{confirmSurvivor.account_number}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>Moving onto it:</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {movedContacts} contacts
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5" /> {movedOpps} opportunities
                  </span>
                  <span>+ their activities, files &amp; partner links</span>
                </div>
                <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                    <div>
                      <div className="font-medium text-yellow-800 dark:text-yellow-200">
                        Archiving {confirmLosers.length} duplicate account
                        {confirmLosers.length === 1 ? "" : "s"}:
                      </div>
                      <ul className="mt-1 space-y-0.5 text-yellow-700 dark:text-yellow-300">
                        {confirmLosers.map((l) => (
                          <li key={l.account_id} className="flex items-center gap-1">
                            <ArrowRight className="h-3 w-3" /> {l.name}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
                        Archived, not deleted — you can undo this from Merge history.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runMerge}>Merge accounts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ======================= Leads that duplicate a contact ===================== */

function LeadDuplicatesPanel() {
  const [tier, setTier] = useState<Exclude<DuplicateTier, "all">>("email");
  const { data: counts } = useLeadDuplicateCounts();
  const { data: rows, isLoading, isError, error } = useLeadContactDuplicates(tier);
  const archiveMutation = useArchiveLeadAsDuplicate();

  const [retireTarget, setRetireTarget] = useState<LeadContactDuplicate | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  function retire(d: LeadContactDuplicate) {
    archiveMutation.mutate(
      { leadId: d.lead_id, contactId: d.contact_id },
      {
        onSuccess: () => toast.success("Lead retired as a duplicate."),
        onError: (err: Error) => toast.error("Couldn't retire lead", { description: err.message }),
      }
    );
  }

  async function retireAllCertain() {
    setBulkOpen(false);
    const list = rows ?? [];
    let ok = 0;
    let fail = 0;
    for (const d of list) {
      try {
        await archiveMutation.mutateAsync({ leadId: d.lead_id, contactId: d.contact_id });
        ok++;
      } catch {
        fail++;
      }
    }
    if (fail === 0) toast.success(`Retired ${ok} duplicate lead${ok === 1 ? "" : "s"}.`);
    else toast.warning(`Retired ${ok}, ${fail} failed.`);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These leads look like people who already exist as a contact. Retiring a lead
        archives it as a duplicate and keeps the contact — nothing is deleted.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SectionButton active={tier === "email"} onClick={() => setTier("email")}>
          Same email — certain{counts ? ` (${counts.email_certain})` : ""}
        </SectionButton>
        <SectionButton active={tier === "name"} onClick={() => setTier("name")}>
          Same name — review{counts ? ` (${counts.name_review})` : ""}
        </SectionButton>
        {tier === "email" && (rows?.length ?? 0) > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setBulkOpen(true)}
            disabled={archiveMutation.isPending}
          >
            Retire all {rows?.length} certain matches
          </Button>
        )}
      </div>

      {tier === "name" && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          These match by name only (no email). Two different people can share a name —
          check each one before retiring.
        </div>
      )}

      {isLoading ? (
        <PanelLoading />
      ) : isError ? (
        <PanelError message={(error as Error)?.message} />
      ) : (rows?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6 text-green-600" />}
          title="Nothing here"
          body={
            tier === "email"
              ? "No leads share an email with an existing contact."
              : "No leads share a name with an existing contact."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="w-8" />
                <TableHead>Already a contact</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((d) => (
                <TableRow key={d.lead_id}>
                  <TableCell>
                    <Link to={`/leads/${d.lead_id}`} target="_blank" className="font-medium text-primary hover:underline">
                      {personName(d.lead_first_name, d.lead_last_name)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[d.lead_email, d.lead_company].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ArrowRight className="h-4 w-4" />
                  </TableCell>
                  <TableCell>
                    <Link to={`/contacts/${d.contact_id}`} target="_blank" className="font-medium text-primary hover:underline">
                      {personName(d.contact_first_name, d.contact_last_name)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[d.contact_email, d.contact_account_name].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRetireTarget(d)}
                      disabled={archiveMutation.isPending}
                    >
                      Retire lead
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!retireTarget}
        onOpenChange={(o) => !o && setRetireTarget(null)}
        title="Retire this lead?"
        description={
          retireTarget
            ? `"${personName(retireTarget.lead_first_name, retireTarget.lead_last_name)}" will be archived as a duplicate of the contact "${personName(retireTarget.contact_first_name, retireTarget.contact_last_name)}". The contact is kept; nothing is deleted.`
            : ""
        }
        confirmLabel="Retire lead"
        onConfirm={() => {
          if (retireTarget) retire(retireTarget);
          setRetireTarget(null);
        }}
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Retire all ${rows?.length ?? 0} certain matches?`}
        description="Each of these leads shares an email with an existing contact, so they're safe to retire. They'll be archived as duplicates and the contacts kept. Nothing is deleted."
        confirmLabel="Retire all"
        onConfirm={retireAllCertain}
      />
    </div>
  );
}

/* ============================ Merge history ============================ */

function MergeHistoryPanel() {
  const { data: rows, isLoading, isError, error } = useAccountMergeHistory();
  const undoMutation = useUndoAccountMerge();
  const [undoTarget, setUndoTarget] = useState<string | null>(null);

  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message={(error as Error)?.message} />;
  if ((rows?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={<Undo2 className="h-6 w-6 text-muted-foreground" />}
        title="No merges yet"
        body="When you merge duplicate accounts, each merge shows up here with an Undo button."
      />
    );
  }

  function undo(id: string) {
    undoMutation.mutate(id, {
      onSuccess: () => toast.success("Merge undone — the accounts are separated again."),
      onError: (err: Error) => toast.error("Undo failed", { description: err.message }),
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every account merge, newest first. Undo puts the records back where they were.
        (Partner links removed during a merge aren't restored — re-add them if needed.)
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Kept account</TableHead>
              <TableHead className="text-right">Merged in</TableHead>
              <TableHead className="text-right">Records moved</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="text-right">Undo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((m) => (
              <TableRow key={m.id} className={m.undone_at ? "opacity-60" : ""}>
                <TableCell className="text-sm text-muted-foreground">{fmtDateTime(m.merged_at)}</TableCell>
                <TableCell>
                  <Link to={`/accounts/${m.survivor_id}`} target="_blank" className="font-medium text-primary hover:underline">
                    {m.survivor?.name ?? "(account)"}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{m.loser_ids?.length ?? 0}</TableCell>
                <TableCell className="text-right">{m.before_state?.reparented_total ?? "—"}</TableCell>
                <TableCell className="text-sm">{m.merged_by_user?.full_name ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {m.undone_at ? (
                    <Badge variant="outline" className="text-xs">Undone</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => setUndoTarget(m.id)}
                      disabled={undoMutation.isPending}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!undoTarget}
        onOpenChange={(o) => !o && setUndoTarget(null)}
        title="Undo this merge?"
        description="The archived accounts come back and every record that moved goes back to where it was. Field edits made after the merge are kept; partner links removed during the merge aren't restored."
        confirmLabel="Undo merge"
        onConfirm={() => {
          if (undoTarget) undo(undoTarget);
          setUndoTarget(null);
        }}
      />
    </div>
  );
}

/* ============================ Small helpers ============================ */

function PanelLoading() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
    </div>
  );
}

function PanelError({ message }: { message?: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      Couldn't load this list{message ? `: ${message}` : "."}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      {icon}
      <div className="font-medium">{title}</div>
      <div className="max-w-sm text-sm text-muted-foreground">{body}</div>
    </Card>
  );
}

function personName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim() || "(no name)";
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
