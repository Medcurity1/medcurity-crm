// The guarded account merge wizard (Nathan, 2026-08-11): lets any CRM
// write-role user merge EXACTLY TWO duplicate accounts with eyes open.
//
// Step 1 — pick the other account (this page's account is pre-selected).
// Step 2 — review every profile field side by side, blanks included; the
//          kept record is chosen up top (recommended pick pre-selected);
//          every row shows which value wins and can be swapped.
// Step 3 — plain-language summary + the one warning that matters, then go.
//
// Design notes: the value cells are toggle buttons (aria-pressed) inside a
// per-row group labeled by the field name — keyboard and screen-reader
// friendly without inventing a new control. All copy follows the D17 rule:
// say what and where, no jargon, no dashes.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Building2, Check, GitMerge, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountCombobox } from "@/components/AccountCombobox";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import {
  buildDefaultPicks, buildFieldChoices, buildFieldRows, conflictCount,
  isBlankValue, MERGE_FIELD_GROUPS,
  type MergeFieldRow, type MergeSide,
  recommendSurvivor,
} from "./merge-logic";
import { useMergeAccountPair, useMergePair, type MergeSideAccount } from "./api";

function fmtValue(row: MergeFieldRow, side: MergeSide, ownerNames: Record<MergeSide, string | null>): string {
  const raw = side === "a" ? row.aValue : row.bValue;
  if (row.def.kind === "owner") {
    return isBlankValue(raw) ? "" : (ownerNames[side] ?? "Unknown user");
  }
  if (isBlankValue(raw)) return "";
  if (row.def.kind === "currency") {
    const n = Number(raw);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : String(raw);
  }
  if (row.def.kind === "cadence") {
    const n = Number(raw);
    return n === 1 ? "Every year" : `Every ${n} years`;
  }
  return String(raw);
}

function SideStats({ acct }: { acct: MergeSideAccount }) {
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <div>#{acct.account_number ?? "—"} · created {acct.created_at ? formatDate(acct.created_at) : "unknown"}</div>
      <div>
        {acct.opportunity_count} deal{acct.opportunity_count === 1 ? "" : "s"}
        {acct.has_closed_won ? " (has a won deal)" : ""} · {acct.contact_count} contact{acct.contact_count === 1 ? "" : "s"}
      </div>
      <div>
        {acct.activity_count} activit{acct.activity_count === 1 ? "y" : "ies"} · {acct.attachment_count} file{acct.attachment_count === 1 ? "" : "s"}
        {acct.owner_name ? ` · owner ${acct.owner_name}` : ""}
      </div>
    </div>
  );
}

export function MergeAccountsDialog({
  open,
  onOpenChange,
  initialAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAccountId: string;
}) {
  const navigate = useNavigate();
  const [otherId, setOtherId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [survivorSide, setSurvivorSide] = useState<MergeSide>("a");
  const [picks, setPicks] = useState<Record<string, MergeSide>>({});
  const [userTouchedSurvivor, setUserTouchedSurvivor] = useState(false);

  const { data: pair, isFetching, error: pairError } = useMergePair(
    step >= 2 ? initialAccountId : null,
    step >= 2 ? otherId : null,
  );
  const merge = useMergeAccountPair();

  // Reset the wizard whenever it opens fresh.
  useEffect(() => {
    if (open) {
      setOtherId(null);
      setStep(1);
      setSurvivorSide("a");
      setPicks({});
      setUserTouchedSurvivor(false);
    }
  }, [open]);

  const rows = useMemo(
    () => (pair ? buildFieldRows(pair.a.fields, pair.b.fields) : []),
    [pair],
  );

  // Recommended survivor (won deal first, then older record) — applied once
  // per loaded pair unless the user has taken over the choice.
  useEffect(() => {
    if (!pair || userTouchedSurvivor) return;
    const rec = recommendSurvivor(
      { id: pair.a.id, created_at: pair.a.created_at, has_closed_won: pair.a.has_closed_won },
      { id: pair.b.id, created_at: pair.b.created_at, has_closed_won: pair.b.has_closed_won },
    );
    setSurvivorSide(rec);
    setPicks(buildDefaultPicks(buildFieldRows(pair.a.fields, pair.b.fields), rec));
  }, [pair, userTouchedSurvivor]);

  function chooseSurvivor(side: MergeSide) {
    setUserTouchedSurvivor(true);
    setSurvivorSide(side);
    // New survivor, new deterministic defaults — swaps start over so the
    // "kept record wins ties" rule stays true and visible.
    setPicks(buildDefaultPicks(rows, side));
  }

  const survivor = pair ? (survivorSide === "a" ? pair.a : pair.b) : null;
  const loser = pair ? (survivorSide === "a" ? pair.b : pair.a) : null;
  const ownerNames: Record<MergeSide, string | null> = {
    a: pair?.a.owner_name ?? null,
    b: pair?.b.owner_name ?? null,
  };

  const fieldChoices = useMemo(
    () => (pair ? buildFieldChoices(rows, picks, survivorSide) : {}),
    [pair, rows, picks, survivorSide],
  );
  const changedCount = Object.keys(fieldChoices).length;

  async function runMerge() {
    if (!pair || !survivor || !loser) return;
    try {
      await merge.mutateAsync({
        survivorId: survivor.id,
        loserId: loser.id,
        fieldChoices,
        expectedSurvivorUpdatedAt: survivor.updated_at,
        expectedLoserUpdatedAt: loser.updated_at,
        reason: `Merged duplicate "${loser.name}" via account page`,
      });
      toast.success(`Merged "${loser.name}" into "${survivor.name}"`, {
        description: "Everything moved over. An admin can undo this from Admin settings if needed.",
      });
      onOpenChange(false);
      // If the page we were on is the record that got archived, land the
      // user on the record that kept everything.
      if (initialAccountId === loser.id) {
        navigate(`/accounts/${survivor.id}`);
      }
    } catch (e) {
      toast.error("Merge didn't run", {
        description: e instanceof Error ? e.message : "Something went wrong. Nothing was changed.",
      });
    }
  }

  const stepTitle =
    step === 1 ? "Merge duplicate accounts"
    : step === 2 ? "Review what the merged account will say"
    : "Last check before merging";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!merge.isPending) onOpenChange(o); }}>
      {/* NOTE: shadcn DialogContent is a GRID — don't fight it with flex.
          The tall step (review) constrains itself via the ScrollArea's
          max-h below, which keeps the footer pinned under the content. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            {stepTitle}
          </DialogTitle>
          <DialogDescription>
            {step === 1 &&
              "Pick the other account that is the same company. You will review every field before anything happens."}
            {step === 2 &&
              "Click a value on either side to keep it. Highlighted values are what the merged account will say."}
            {step === 3 &&
              "Nothing has happened yet. Read this summary, then merge."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">This account is a duplicate of…</label>
            <AccountCombobox
              value={otherId}
              onChange={(id) => setOtherId(id === initialAccountId ? null : id)}
              placeholder="Search for the other account…"
            />
            <p className="text-xs text-muted-foreground">
              Merging combines two accounts into one: every contact, deal, activity, file and
              link ends up on the account you keep, and the other account is archived (nothing
              is deleted). An admin can undo it afterwards.
            </p>
          </div>
        )}

        {step === 2 && (
          <>
            {isFetching && !pair && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading both accounts…
              </div>
            )}
            {pairError != null && (
              <div className="text-sm text-destructive py-6">
                Couldn't load the two accounts: {pairError instanceof Error ? pairError.message : "unknown error"}
              </div>
            )}
            {pair && survivor && loser && (
              <ScrollArea className="max-h-[62vh] overflow-y-auto pr-3 -mr-3">
                {/* ── Which record survives ─────────────────────────── */}
                <div className="rounded-md border p-3 mb-4 bg-muted/30">
                  <div className="text-sm font-medium mb-2">Which record should be kept?</div>
                  <div className="grid grid-cols-2 gap-3">
                    {(["a", "b"] as MergeSide[]).map((side) => {
                      const acct = side === "a" ? pair.a : pair.b;
                      const selected = survivorSide === side;
                      return (
                        <button
                          key={side}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => chooseSurvivor(side)}
                          className={cn(
                            "rounded-md border p-3 text-left transition-colors",
                            selected
                              ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                              : "hover:border-muted-foreground/40",
                          )}
                        >
                          <div className="flex items-center gap-2 font-medium text-sm">
                            <Building2 className="h-4 w-4 shrink-0" />
                            <span className="truncate">{acct.name}</span>
                            {selected && <Badge className="ml-auto shrink-0">Kept</Badge>}
                          </div>
                          <div className="mt-1.5">
                            <SideStats acct={acct} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The kept record stays live and keeps its account number. The other record is
                    archived, and everything on it moves to the kept record. Won-deal history and
                    the older record make the best keeper, so that one is pre-selected.
                  </p>
                </div>

                {/* ── Field-by-field review ─────────────────────────── */}
                <div className="text-xs text-muted-foreground mb-2">
                  {conflictCount(rows)} field{conflictCount(rows) === 1 ? " has" : "s have"} different
                  values on the two records. Click either side's value to keep it.
                </div>
                {MERGE_FIELD_GROUPS.map((group) => {
                  const groupRows = rows.filter((r) => r.def.group === group);
                  if (groupRows.length === 0) return null;
                  return (
                    <div key={group} className="mb-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {group}
                      </div>
                      <div className="rounded-md border divide-y">
                        {groupRows.map((row) => {
                          const pick = picks[row.def.key] ?? survivorSide;
                          return (
                            <div
                              key={row.def.key}
                              role="group"
                              aria-label={row.def.label}
                              className={cn(
                                "grid grid-cols-[9rem_1fr_1fr] items-stretch text-sm",
                                row.state === "conflict" && "bg-amber-50/60 dark:bg-amber-950/10",
                              )}
                            >
                              <div className="px-2 py-1.5 text-xs text-muted-foreground self-center">
                                {row.def.label}
                                {row.state === "conflict" && (
                                  <span className="block text-[10px] text-amber-700 dark:text-amber-400">differs</span>
                                )}
                              </div>
                              {(["a", "b"] as MergeSide[]).map((side) => {
                                const text = fmtValue(row, side, ownerNames);
                                const chosen = pick === side;
                                return (
                                  <button
                                    key={side}
                                    type="button"
                                    aria-pressed={chosen}
                                    aria-label={`${row.def.label}: keep ${text || "blank"} from ${side === "a" ? pair.a.name : pair.b.name}`}
                                    onClick={() =>
                                      setPicks((p) => ({ ...p, [row.def.key]: side }))
                                    }
                                    className={cn(
                                      "px-2 py-1.5 text-left border-l min-h-[2.1rem] break-words",
                                      chosen
                                        ? "bg-primary/10 font-medium"
                                        : "text-muted-foreground hover:bg-muted/50",
                                    )}
                                  >
                                    <span className="flex items-start gap-1.5">
                                      {chosen && <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />}
                                      {text !== "" ? (
                                        <span className="whitespace-pre-wrap">{text}</span>
                                      ) : (
                                        <span className="italic text-muted-foreground/70">blank</span>
                                      )}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* ── Locked compliance flags ───────────────────────── */}
                {(pair.a.do_not_contact || pair.b.do_not_contact || pair.a.partner_prospect || pair.b.partner_prospect) && (
                  <div className="rounded-md border p-2.5 text-xs text-muted-foreground mb-2">
                    <span className="font-medium text-foreground">Set automatically: </span>
                    {(pair.a.do_not_contact || pair.b.do_not_contact) && (
                      <span>"Do not contact" stays ON because one of the records has it. </span>
                    )}
                    {(pair.a.partner_prospect || pair.b.partner_prospect) && (
                      <span>"Partner prospect" stays ON because one of the records has it.</span>
                    )}
                  </div>
                )}
              </ScrollArea>
            )}
          </>
        )}

        {step === 3 && pair && survivor && loser && (
          <div className="space-y-3 py-1 text-sm">
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{loser.name}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">{survivor.name}</span>
                <Badge className="shrink-0">kept</Badge>
              </div>
              <ul className="text-muted-foreground text-xs space-y-1 list-disc pl-4">
                <li>
                  {loser.contact_count} contact{loser.contact_count === 1 ? "" : "s"}, {loser.opportunity_count} deal{loser.opportunity_count === 1 ? "" : "s"}, {loser.activity_count} activit{loser.activity_count === 1 ? "y" : "ies"} and {loser.attachment_count} file{loser.attachment_count === 1 ? "" : "s"} move to "{survivor.name}".
                </li>
                <li>
                  "{loser.name}" is archived, not deleted. It disappears from lists and search.
                </li>
                <li>
                  {changedCount === 0
                    ? "The kept record's details stay exactly as they are."
                    : `${changedCount} field${changedCount === 1 ? "" : "s"} on the kept record ${changedCount === 1 ? "changes" : "change"} to the values you picked.`}
                </li>
              </ul>
            </div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200 flex gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="text-xs">
                This affects real records for the whole team. If it turns out to be wrong, an
                admin can undo it from Admin settings, which restores both accounts and moves
                everything back.
              </div>
            </div>
          </div>
        )}

        {/* gap-2 at every width — the old `sm:gap-0` shadcn pattern glued
            Back/Continue together on desktop (Nathan, 8/12). */}
        <DialogFooter className="gap-2">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!otherId} onClick={() => setStep(2)}>
                Review the two accounts
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!pair} onClick={() => setStep(3)}>
                Continue
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" disabled={merge.isPending} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                onClick={runMerge}
                disabled={merge.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {merge.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {merge.isPending ? "Merging…" : "Merge accounts"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
