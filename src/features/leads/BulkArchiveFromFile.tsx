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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Loader2, Archive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { parseCsv } from "@/features/playbook/csv";
import { useBulkArchiveFromList, type BulkArchiveResult } from "./api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedFile {
  fileName: string;
  rowCount: number;
  ids: string[];
  emails: string[];
  suggestedReason: string;
}

// Pull lead IDs + emails out of a verification export. Matches the header by
// name ("ID", "Email"), keeps only well-formed UUIDs / emails, dedups, and
// suggests a reason from the dominant `quality` value (bad / risky / good).
function extractFromCsv(fileName: string, text: string): ParsedFile | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === "id");
  const emailCol = header.findIndex(
    (h) => h === "email" || h === "e-mail" || h === "email_address",
  );
  const qualityCol = header.findIndex((h) => h === "quality" || h === "result");

  const ids = new Set<string>();
  const emails = new Set<string>();
  const qualityCounts: Record<string, number> = {};
  const data = rows.slice(1);
  for (const r of data) {
    if (idCol >= 0) {
      const id = (r[idCol] ?? "").trim();
      if (UUID_RE.test(id)) ids.add(id.toLowerCase());
    }
    if (emailCol >= 0) {
      const e = (r[emailCol] ?? "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) emails.add(e);
    }
    if (qualityCol >= 0) {
      const q = (r[qualityCol] ?? "").trim().toLowerCase();
      if (q && q !== "—") qualityCounts[q] = (qualityCounts[q] ?? 0) + 1;
    }
  }
  const dominant = Object.entries(qualityCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    fileName,
    rowCount: data.length,
    ids: [...ids],
    emails: [...emails],
    suggestedReason: dominant ? `MillionVerifier: ${dominant}` : "MillionVerifier cleaning",
  };
}

export function BulkArchiveFromFile({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BulkArchiveResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const archive = useBulkArchiveFromList();

  function reset() {
    setParsed(null);
    setReason("");
    setPreview(null);
    setParseError(null);
    setConfirmOpen(false);
    setProgress(null);
  }

  // Chunk the id list so each RPC call archives a small batch. A single
  // statement over thousands of rows (plus per-row triggers) blows past the
  // DB statement timeout — small batches keep every call fast.
  const CHUNK = 1000;
  async function runChunked(dryRun: boolean): Promise<BulkArchiveResult | null> {
    if (!parsed) return null;
    const batches: string[][] = [];
    for (let i = 0; i < parsed.ids.length; i += CHUNK) batches.push(parsed.ids.slice(i, i + CHUNK));
    const agg: BulkArchiveResult = {
      matched: 0,
      already_archived: 0,
      to_archive: 0,
      archived: 0,
      dry_run: dryRun,
    };
    setRunning(true);
    setProgress({ done: 0, total: parsed.ids.length });
    try {
      let done = 0;
      for (const b of batches) {
        const r = await archive.mutateAsync({
          ids: b,
          emails: [],
          reason: reason.trim() || "bulk cleaning",
          dryRun,
        });
        agg.matched += r.matched;
        agg.already_archived += r.already_archived;
        agg.to_archive += r.to_archive;
        agg.archived += r.archived;
        done += b.length;
        setProgress({ done, total: parsed.ids.length });
      }
      return agg;
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setParseError(null);
    setPreview(null);
    setParsed(null);
    try {
      const text = await file.text();
      const p = extractFromCsv(file.name, text);
      if (!p || (p.ids.length === 0 && p.emails.length === 0)) {
        setParseError(
          "Couldn't find any lead IDs or emails in that file. Expected an 'ID' and/or 'Email' column.",
        );
        return;
      }
      setParsed(p);
      setReason(p.suggestedReason);
    } catch (err) {
      setParseError("Failed to read the file: " + (err as Error).message);
    }
  }

  async function runPreview() {
    try {
      const r = await runChunked(true);
      if (r) setPreview(r);
    } catch (err) {
      toast.error("Preview failed: " + (err as Error).message);
    }
  }

  async function runArchive() {
    try {
      const r = await runChunked(false);
      if (r) {
        toast.success(`Archived ${r.archived.toLocaleString()} lead${r.archived === 1 ? "" : "s"}.`);
        reset();
        onOpenChange(false);
      }
    } catch (err) {
      toast.error("Archive failed: " + (err as Error).message);
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
              <Archive className="h-5 w-5 text-amber-600" /> Bulk archive from file
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a verification export (e.g. a MillionVerifier <span className="font-medium">bad</span> or{" "}
              <span className="font-medium">risky</span> file). We match its rows to your existing leads by{" "}
              <span className="font-medium">ID and email</span>, then archive the matches. Nothing is archived
              until you review the preview and confirm.
            </p>

            <div className="space-y-2">
              <Label htmlFor="bulk-archive-file">CSV file</Label>
              <Input id="bulk-archive-file" type="file" accept=".csv,text/csv" onChange={onFile} />
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
                  {parsed.rowCount.toLocaleString()} rows · {parsed.ids.length.toLocaleString()} IDs ·{" "}
                  {parsed.emails.length.toLocaleString()} emails
                </div>
              </div>
            )}

            {parsed && (
              <div className="space-y-2">
                <Label htmlFor="bulk-archive-reason">
                  Archive reason <span className="text-muted-foreground font-normal">(stamped on each lead; excludes them from future imports)</span>
                </Label>
                <Input
                  id="bulk-archive-reason"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setPreview(null); // reason changed → re-preview
                  }}
                  placeholder="MillionVerifier: bad"
                />
              </div>
            )}

            {preview && (
              <div className="rounded-md border border-amber-300/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <div className="font-semibold text-amber-800 dark:text-amber-200">Preview</div>
                <div className="text-amber-900/80 dark:text-amber-100/80">
                  <span className="font-semibold">{preview.matched.toLocaleString()}</span> matched
                  {preview.already_archived > 0 && (
                    <> · {preview.already_archived.toLocaleString()} already archived</>
                  )}
                  {" · "}
                  <span className="font-semibold">{preview.to_archive.toLocaleString()}</span> will be archived
                </div>
                {preview.to_archive === 0 && (
                  <div className="mt-1 text-xs text-amber-900/70 dark:text-amber-100/70">
                    Nothing to archive — none of these rows matched an active lead.
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
            {preview && preview.to_archive > 0 && (
              <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={running}>
                Archive {preview.to_archive.toLocaleString()} lead{preview.to_archive === 1 ? "" : "s"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Archive ${preview?.to_archive.toLocaleString() ?? 0} leads?`}
        description={`They'll be archived with the reason "${reason.trim() || "bulk cleaning"}" and excluded from future imports. You can still find them in the Archive tab. This runs immediately.`}
        confirmLabel="Archive them"
        destructive
        onConfirm={runArchive}
      />
    </>
  );
}
