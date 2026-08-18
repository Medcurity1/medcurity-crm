// "Do Not Email" — the marketing suppression list. Every contact + import we
// must NOT email, each tagged with a reason. Filter to one category for a
// targeted list, or keep "All" for the master sheet, then Export CSV and
// subtract it from any campaign list. Backed by v_marketing_suppression.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ShieldX, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAddManualOptout } from "@/features/playbook/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { downloadCsv, todayStamp } from "./report-helpers";
import { fetchUsersById, fetchAllRows } from "./report-fetchers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";
import { useDialogDiscardGuard } from "@/hooks/useDialogDiscardGuard";

// Same basic shape-check as CampaignRecipients.tsx's EMAIL_RE — good enough
// to catch a typo before a round trip; the edge function normalizes and
// validates for real server-side.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Friendly label per reason (the view's raw reason codes).
const REASON_LABEL: Record<string, string> = {
  customer_account: "Customer account",
  former_customer_account: "Past customer",
  partner_account: "Partner account",
  contact_do_not_contact: "Do not contact",
  account_do_not_contact: "Account: do not contact",
  contact_no_longer_employed: "No longer employed",
  contact_archived: "Archived contact",
  lead_do_not_market: "Import: do not market",
  lead_do_not_contact: "Import: do not contact",
  lead_avoid: "Import: avoid (bounced/unsub)",
  lead_archived: "Import: archived",
  optout_unsubscribed: "Unsubscribed (campaign)",
  optout_bounced: "Bounced (campaign)",
  optout_manual: "Opted out (manual)",
};

// Category filter → which reasons it includes.
const CATEGORIES: { value: string; label: string; reasons: string[] | null }[] = [
  { value: "all", label: "All (master list)", reasons: null },
  { value: "customer", label: "Customer-account contacts", reasons: ["customer_account"] },
  { value: "partner", label: "Partner-account contacts", reasons: ["partner_account"] },
  { value: "former", label: "Past customers", reasons: ["former_customer_account"] },
  { value: "do_not_market", label: "Do-not-market / do-not-contact", reasons: ["contact_do_not_contact", "account_do_not_contact", "lead_do_not_market", "lead_do_not_contact"] },
  { value: "nle_bounced", label: "No longer employed / bounced / archived", reasons: ["contact_no_longer_employed", "contact_archived", "lead_avoid", "lead_archived", "optout_bounced"] },
  { value: "optout", label: "Unsubscribed / opted out (campaigns)", reasons: ["optout_unsubscribed", "optout_manual"] },
];

interface SuppRow {
  source_kind: "contact" | "lead" | "optout";
  source_id: string;
  reason: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
  account_id: string | null;
  owner_user_id: string | null;
}

export function DoNotEmail() {
  const [category, setCategory] = useState("all");
  const reasons = CATEGORIES.find((c) => c.value === category)?.reasons ?? null;
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  // Escape hatch for campaign opt-out rows (2026-07-28): unsubscribes are
  // non-overridable at launch, so without this an accidental or forged
  // unsubscribe would block an address forever. Admin-only (RLS enforces it
  // too; the column-scoped grant allows flipping revoked_at and nothing
  // else). The row stays in marketing_optouts as history — it just leaves
  // the suppression view.
  const reallow = useMutation({
    mutationFn: async (optoutId: string) => {
      const { error: revokeErr } = await supabase
        .from("marketing_optouts")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", optoutId);
      if (revokeErr) throw revokeErr;
    },
    onSuccess: () => {
      toast.success("Re-allowed — this address can be emailed again.");
      qc.invalidateQueries({ queryKey: ["report", "do-not-email"] });
    },
    onError: (e) => toast.error("Couldn't re-allow: " + (e as Error).message),
  });

  // Admin manual opt-out (docket I33) — suppress an address that hasn't
  // bounced/unsubscribed from a real send but still needs to be kept out of
  // marketing (e.g. a request that came in by phone or email). The mutation
  // itself toasts success/error and invalidates this report's query.
  const addOptout = useAddManualOptout();
  const [optoutOpen, setOptoutOpen] = useState(false);
  const [optoutEmail, setOptoutEmail] = useState("");
  const [optoutNote, setOptoutNote] = useState("");
  const optoutEmailValid = EMAIL_RE.test(optoutEmail.trim());

  function closeOptoutDialog() {
    setOptoutOpen(false);
    setOptoutEmail("");
    setOptoutNote("");
  }

  // Guard against a stray outside-click/Esc discarding a half-typed
  // opt-out.
  const optoutDirty = optoutEmail.trim() !== "" || optoutNote.trim() !== "";
  const optoutDiscard = useDialogDiscardGuard(optoutDirty, closeOptoutDialog);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["report", "do-not-email", category],
    queryFn: async () => {
      const rows = await fetchAllRows<SuppRow>(
        () => {
          let q = supabase
            .from("v_marketing_suppression")
            .select("source_kind, source_id, reason, first_name, last_name, email, company, account_id, owner_user_id");
          if (reasons) q = q.in("reason", reasons);
          return q.order("email", { ascending: true });
        },
        1000,
        200_000, // multi-row + ~30k imports can run large; well under any real cap
      );
      const ownerIds = new Set(rows.map((r) => r.owner_user_id).filter(Boolean) as string[]);
      const users = await fetchUsersById(ownerIds);
      return rows.map((r) => ({
        ...r,
        owner_name: r.owner_user_id ? users.get(r.owner_user_id)?.full_name ?? "Unassigned" : "Unassigned",
      }));
    },
  });

  const rows = data ?? [];
  const distinctEmails = useMemo(
    () => new Set(rows.map((r) => (r.email || "").trim().toLowerCase())).size,
    [rows],
  );

  function exportCsv() {
    const header = ["First Name", "Last Name", "Email", "Company", "Reason", "Source", "Owner"];
    const out = rows.map((r) => [
      r.first_name ?? "",
      r.last_name ?? "",
      r.email,
      r.company ?? "",
      REASON_LABEL[r.reason] ?? r.reason,
      r.source_kind === "lead" ? "Import" : r.source_kind === "optout" ? "Campaign opt-out" : "Contact",
      r.owner_name,
    ]);
    downloadCsv(`do-not-email-${category}-${todayStamp()}.csv`, [header, ...out]);
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Do Not Email"
        description="Everyone to suppress from marketing — customers, partners, past customers, do-not-contact/do-not-market, and bounced/archived. Filter to one category or keep the master list, export, and subtract it from your campaign list."
        actions={
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading || !rows.length}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setOptoutOpen(true)}>
                <UserX className="h-4 w-4 mr-1" /> Opt out an email…
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Rows" value={isLoading ? "…" : rows.length.toLocaleString()} icon />
        <Kpi label="Unique emails to suppress" value={isLoading ? "…" : distinctEmails.toLocaleString()} />
        <Kpi label="Category" value={CATEGORIES.find((c) => c.value === category)?.label ?? ""} />
      </div>

      <p className="text-xs text-muted-foreground">
        A person can appear once per reason (e.g. a customer contact who is also do-not-contact), so "Rows" ≥ "Unique
        emails". For suppression, subtract the email column. Imports come from the leads/imports pool (will retire with it).
      </p>

      <PreviewNote total={rows.length} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>First Name</TableHead>
                  <TableHead>Last Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="p-4"><Skeleton className="h-48 w-full" /></TableCell></TableRow>
                ) : isError ? (
                  <TableRow><TableCell colSpan={7} className="p-4"><QueryError compact message="Couldn't load this report." onRetry={() => refetch()} isRetrying={isFetching} /></TableCell></TableRow>
                ) : !rows.length ? (
                  <TableRow><TableCell colSpan={7} className="p-6 text-sm text-muted-foreground text-center">Nothing to suppress in this category.</TableCell></TableRow>
                ) : (
                  rows.slice(0, PREVIEW_LIMIT).map((r) => {
                    // Campaign opt-out rows (source_kind 'optout') point at a
                    // marketing_optouts row, not a contact/import — no record
                    // page to link to.
                    const href = r.source_kind === "lead" ? `/imports/${r.source_id}` : r.source_kind === "optout" ? null : `/contacts/${r.source_id}`;
                    return (
                      <TableRow key={`${r.source_kind}-${r.source_id}-${r.reason}`}>
                        <TableCell>{href ? <Link target="_blank" rel="noopener noreferrer" to={href} className="text-primary hover:underline">{r.first_name}</Link> : (r.first_name ?? "—")}</TableCell>
                        <TableCell>{r.last_name}</TableCell>
                        <TableCell>{r.email}</TableCell>
                        <TableCell>
                          {r.account_id ? (
                            <Link target="_blank" rel="noopener noreferrer" to={`/accounts/${r.account_id}`} className="text-primary hover:underline">{r.company}</Link>
                          ) : r.company}
                        </TableCell>
                        <TableCell>{REASON_LABEL[r.reason] ?? r.reason}</TableCell>
                        <TableCell>
                          {r.source_kind === "lead" ? "Import" : r.source_kind === "optout" ? (
                            <span className="inline-flex items-center gap-2">
                              Campaign opt-out
                              {isAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  disabled={reallow.isPending}
                                  onClick={() => reallow.mutate(r.source_id)}
                                  title="Remove this opt-out so the address can be emailed again"
                                >
                                  Re-allow
                                </Button>
                              )}
                            </span>
                          ) : "Contact"}
                        </TableCell>
                        <TableCell>{r.owner_name}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={optoutOpen} onOpenChange={optoutDiscard.guardedOnOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opt out an email</DialogTitle>
            <DialogDescription>
              This permanently opts the address out of marketing sends — it won't be included in any future campaign.
              An admin can undo it later with Re-allow, same as a real unsubscribe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="optout-email">Email</Label>
              <Input
                id="optout-email"
                type="email"
                placeholder="name@company.com"
                value={optoutEmail}
                onChange={(e) => setOptoutEmail(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="optout-note">Note (optional)</Label>
              <Input
                id="optout-note"
                placeholder="Why this address is being opted out"
                value={optoutNote}
                onChange={(e) => setOptoutNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={optoutDiscard.requestClose}>Cancel</Button>
            <Button
              disabled={!optoutEmailValid || addOptout.isPending}
              onClick={() =>
                addOptout.mutate(
                  { email: optoutEmail.trim(), note: optoutNote.trim() || undefined },
                  { onSuccess: closeOptoutDialog },
                )
              }
            >
              {addOptout.isPending ? "Opting out…" : "Opt out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {optoutDiscard.dialog}
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
          {icon && <ShieldX className="h-3.5 w-3.5" />} {label}
        </p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
