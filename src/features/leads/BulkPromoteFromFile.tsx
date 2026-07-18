import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Loader2, UserCheck, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { parseCsv } from "@/features/playbook/csv";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types/crm";
import { TagPicker } from "@/features/tags/TagPicker";
import { tagColorClass } from "@/features/tags/TagChips";
import {
  useCountPromotable,
  useBulkPromoteImports,
  resolveLeadIdsByEmail,
  type PromotePreview,
  type BulkPromoteResult,
} from "./api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Promotion is heavy per row (dedup + account match/create + contact insert),
// so keep batches small. Preview is a cheap count, so it can go wider.
// Sized down 2026-07-17 after Jordan's 13k file hit statement timeouts:
// with migration 20260717000006's indexed dedup each call is subsecond,
// but smaller chunks keep every call far from the 8s limit regardless.
const PROMOTE_CHUNK = 150;
const PREVIEW_CHUNK = 1000;

interface ParsedFile {
  fileName: string;
  rowCount: number;
  /** Final lead ids to work: explicit ID column ∪ ids resolved from emails. */
  ids: string[];
  emailCount: number;
  emailMatched: number;
}

// Accepts an "ID" column, an "Email" column, or both (same ergonomics as
// Bulk Archive From File — Jordan's clean lists come back keyed by email).
function extractIdsAndEmails(text: string): { ids: string[]; emails: string[]; rowCount: number } | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === "id");
  const emailCol = header.findIndex(
    (h) => h === "email" || h === "e-mail" || h === "email_address",
  );
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const r of rows.slice(1)) {
    if (idCol >= 0) {
      const id = (r[idCol] ?? "").trim();
      if (UUID_RE.test(id)) ids.add(id.toLowerCase());
    }
    if (emailCol >= 0) {
      const e = (r[emailCol] ?? "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) emails.add(e);
    }
  }
  return { ids: [...ids], emails: [...emails], rowCount: rows.length - 1 };
}

function chunk(ids: string[], n: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

export function BulkPromoteFromFile({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchTags, setBatchTags] = useState<Tag[]>([]);
  // Persistent post-run summary. The old flow closed the dialog with only a
  // toast — a run with silent skips/errors looked like success (2026-07-17:
  // 205 rows failed invisibly). Now the dialog stays open and itemizes.
  const [result, setResult] = useState<BulkPromoteResult | null>(null);
  // Opt-in: promote ambiguous-company leads as account-less contacts
  // instead of skipping them (Nathan 2026-07-17, for clearing batches
  // stuck on duplicate/same-named accounts).
  const [ambiguousAccountless, setAmbiguousAccountless] = useState(false);
  const countPromotable = useCountPromotable();
  const promote = useBulkPromoteImports();

  function reset() {
    setParsed(null);
    setPreview(null);
    setParseError(null);
    setConfirmOpen(false);
    setProgress(null);
    setBatchTags([]);
    setResult(null);
    setAmbiguousAccountless(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setPreview(null);
    setParsed(null);
    setResult(null);
    try {
      const text = await file.text();
      const p = extractIdsAndEmails(text);
      if (!p || (p.ids.length === 0 && p.emails.length === 0)) {
        setParseError(
          "Couldn't find any lead IDs or emails in that file. Expected an 'ID' or 'Email' column.",
        );
        return;
      }
      // Emails → lead ids server-side, merged with any explicit ids.
      let emailMatched = 0;
      const ids = new Set(p.ids);
      if (p.emails.length > 0) {
        setRunning(true);
        try {
          const resolved = await resolveLeadIdsByEmail(p.emails);
          emailMatched = resolved.length;
          for (const id of resolved) ids.add(id);
        } finally {
          setRunning(false);
        }
      }
      if (ids.size === 0) {
        setParseError(
          "None of the emails in that file matched an existing lead (and no ID column was present).",
        );
        return;
      }
      setParsed({
        fileName: file.name,
        rowCount: p.rowCount,
        ids: [...ids],
        emailCount: p.emails.length,
        emailMatched,
      });
    } catch (err) {
      setRunning(false);
      setParseError("Failed to read the file: " + (err as Error).message);
    }
  }

  async function runPreview() {
    if (!parsed) return;
    const batches = chunk(parsed.ids, PREVIEW_CHUNK);
    const agg: PromotePreview = { matched: 0, promotable: 0, already_done: 0, already_contact: 0 };
    setRunning(true);
    setProgress({ done: 0, total: parsed.ids.length });
    try {
      let done = 0;
      for (const b of batches) {
        const r = await countPromotable.mutateAsync(b);
        agg.matched += r.matched;
        agg.promotable += r.promotable;
        agg.already_done += r.already_done;
        agg.already_contact += r.already_contact;
        done += b.length;
        setProgress({ done, total: parsed.ids.length });
      }
      setPreview(agg);
    } catch (err) {
      toast.error("Preview failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function runPromote() {
    if (!parsed) return;
    const batches = chunk(parsed.ids, PROMOTE_CHUNK);
    const agg: BulkPromoteResult = {
      promoted: 0,
      skipped_duplicate: 0,
      skipped_ambiguous: 0,
      skipped_other: 0,
      errors: 0,
      last_error: null,
      error_detail: [],
      ambiguous_detail: [],
    };
    setRunning(true);
    setProgress({ done: 0, total: parsed.ids.length });
    try {
      let done = 0;
      const tagIds = batchTags.map((t) => t.id);
      for (const b of batches) {
        const r = await promote.mutateAsync({ ids: b, tagIds, ambiguousAccountless });
        agg.promoted += r.promoted;
        agg.promoted_ambiguous_accountless =
          (agg.promoted_ambiguous_accountless ?? 0) + (r.promoted_ambiguous_accountless ?? 0);
        agg.skipped_duplicate += r.skipped_duplicate;
        agg.skipped_ambiguous += r.skipped_ambiguous;
        agg.skipped_other += r.skipped_other;
        agg.errors += r.errors;
        if (r.last_error) agg.last_error = r.last_error;
        if (r.error_detail?.length && agg.error_detail!.length < 25) {
          agg.error_detail!.push(...r.error_detail.slice(0, 25 - agg.error_detail!.length));
        }
        if (r.ambiguous_detail?.length && agg.ambiguous_detail!.length < 25) {
          agg.ambiguous_detail!.push(
            ...r.ambiguous_detail.slice(0, 25 - agg.ambiguous_detail!.length),
          );
        }
        done += b.length;
        setProgress({ done, total: parsed.ids.length });
      }
      toast.success(`Promoted ${agg.promoted.toLocaleString()} to contacts.`);
      // Keep the dialog open on the itemized summary — every bucket visible,
      // nothing silently swallowed. Close is the user's call.
      setResult(agg);
      setPreview(null);
      setConfirmOpen(false);
    } catch (err) {
      toast.error("Promote failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          onOpenChange(o);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-600" /> Bulk promote from file
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a verified <span className="font-medium">"good"</span> list (e.g. a MillionVerifier OK
              export). We match its rows to your existing leads by <span className="font-medium">ID or
              email</span> and promote them to{" "}
              <span className="font-medium">Contacts</span> — matching or creating an account, and skipping
              anyone who's already a contact. Nothing happens until you review the preview and confirm.
            </p>

            <div className="space-y-2">
              <Label htmlFor="bulk-promote-file">CSV file</Label>
              <Input id="bulk-promote-file" type="file" accept=".csv,text/csv" onChange={onFile} />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {parseError}
              </div>
            )}

            {parsed && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="font-medium truncate">{parsed.fileName}</div>
                <div className="text-muted-foreground">
                  {parsed.rowCount.toLocaleString()} rows · {parsed.ids.length.toLocaleString()} leads matched
                  {parsed.emailCount > 0 && (
                    <> · {parsed.emailMatched.toLocaleString()} of {parsed.emailCount.toLocaleString()} emails found</>
                  )}
                </div>
              </div>
            )}

            {parsed && (
              <div className="space-y-2">
                <Label>Tag the new contacts (recommended)</Label>
                <p className="text-xs text-muted-foreground">
                  Every contact this run creates gets these tags — so the batch stays
                  filterable later (e.g. "Jordan Clean Jul 2026").
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {batchTags.map((t) => (
                    <Badge key={t.id} className={cn("gap-1 border-transparent", tagColorClass(t.color))}>
                      {t.name}
                      <button
                        type="button"
                        onClick={() => setBatchTags((prev) => prev.filter((x) => x.id !== t.id))}
                        className="opacity-70 hover:opacity-100"
                        aria-label={`Remove ${t.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <TagPicker
                    appliedTagIds={batchTags.map((t) => t.id)}
                    onPick={(tag) =>
                      setBatchTags((prev) =>
                        prev.some((x) => x.id === tag.id) ? prev : [...prev, tag],
                      )
                    }
                  />
                </div>
              </div>
            )}

            {parsed && (
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  id="ambiguous-accountless"
                  checked={ambiguousAccountless}
                  onCheckedChange={(v) => setAmbiguousAccountless(v === true)}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="ambiguous-accountless" className="cursor-pointer">
                    Promote ambiguous companies without an account
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When a lead's company matches more than one account, promote the person
                    anyway with no account attached (instead of skipping). The company name
                    stays on the linked lead; attach the right account later.
                  </p>
                </div>
              </div>
            )}

            {preview && (
              <div className="rounded-md border border-emerald-300/50 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
                <div className="font-semibold text-emerald-800 dark:text-emerald-200">Preview</div>
                <div className="text-emerald-900/80 dark:text-emerald-100/80">
                  <span className="font-semibold">{preview.promotable.toLocaleString()}</span> will be promoted
                  to contacts
                  {preview.already_contact > 0 && (
                    <> · {preview.already_contact.toLocaleString()} already contacts</>
                  )}
                  {preview.already_done > 0 && (
                    <> · {preview.already_done.toLocaleString()} already converted/archived</>
                  )}
                </div>
                {preview.promotable === 0 && (
                  <div className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                    Nothing to promote — none of these matched a promotable lead.
                  </div>
                )}
                <div className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                  Preview is an upper bound: rows can still be skipped at promote time
                  (e.g. a company name matching two accounts) — the run summary itemizes
                  anything that doesn't make it.
                </div>
              </div>
            )}

            {result && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                <div className="font-semibold">Run summary</div>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">{result.promoted.toLocaleString()}</span>{" "}
                    promoted to contacts
                    {(result.promoted_ambiguous_accountless ?? 0) > 0 && (
                      <> — {result.promoted_ambiguous_accountless!.toLocaleString()} of them without an
                      account (ambiguous company)</>
                    )}
                  </li>
                  {result.skipped_duplicate > 0 && (
                    <li>{result.skipped_duplicate.toLocaleString()} skipped — already contacts</li>
                  )}
                  {result.skipped_ambiguous > 0 && (
                    <li>
                      {result.skipped_ambiguous.toLocaleString()} skipped — company name matches more
                      than one account (safer by hand)
                    </li>
                  )}
                  {result.skipped_other > 0 && (
                    <li>{result.skipped_other.toLocaleString()} skipped — already converted or archived</li>
                  )}
                  {result.errors > 0 && (
                    <li className="text-destructive">{result.errors.toLocaleString()} failed with errors</li>
                  )}
                </ul>
                {(result.error_detail?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-destructive">
                      Failed rows (first {result.error_detail!.length}):
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border bg-background/60 p-2 text-xs font-mono space-y-1">
                      {result.error_detail!.map((e) => (
                        <div key={e.lead_id}>
                          <a
                            className="text-primary underline-offset-2 hover:underline"
                            href={`/leads/${e.lead_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {e.lead_id.slice(0, 8)}…
                          </a>{" "}
                          {e.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(result.ambiguous_detail?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">
                      {(result.promoted_ambiguous_accountless ?? 0) > 0
                        ? `Promoted account-less — ambiguous company (first ${result.ambiguous_detail!.length}):`
                        : `Ambiguous companies (first ${result.ambiguous_detail!.length}):`}
                    </div>
                    <div className="max-h-32 overflow-y-auto rounded border bg-background/60 p-2 text-xs font-mono space-y-1">
                      {result.ambiguous_detail!.map((a) => (
                        <div key={a.lead_id}>
                          <a
                            className="text-primary underline-offset-2 hover:underline"
                            href={`/leads/${a.lead_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {a.lead_id.slice(0, 8)}…
                          </a>{" "}
                          {a.company ?? "—"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {running && progress && (
            <div className="text-xs text-muted-foreground">
              Working… {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
            </div>
          )}
          <DialogFooter className="gap-2">
            {parsed && (
              <Button variant="outline" onClick={runPreview} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {preview ? "Re-check" : "Preview matches"}
              </Button>
            )}
            {preview && preview.promotable > 0 && (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={running}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Promote {preview.promotable.toLocaleString()} to contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Promote ${preview?.promotable.toLocaleString() ?? 0} leads to contacts?`}
        description="Each becomes a Contact (with a matched or newly-created Account). Anyone already a contact is skipped. This runs immediately and can't be bulk-undone."
        confirmLabel="Promote them"
        onConfirm={runPromote}
      />
    </>
  );
}
