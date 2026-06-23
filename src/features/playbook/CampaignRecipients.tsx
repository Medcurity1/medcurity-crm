// Campaign recipients picker — three sources that all accumulate (with
// dedup): a contact tag (custom list), a CSV/.txt upload with column mapping,
// or pasted emails. Shows a managed recipient table.

import { useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { fetchRecipientsByTag, type Recipient } from "./api";
import { parseCsv, guessField, rowsToRecipients, FIELD_LABEL, type RecipientField } from "./csv";

const FIELD_OPTIONS: RecipientField[] = ["email", "first_name", "last_name", "company_name", "skip"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CampaignRecipients({
  recipients, setRecipients, tags,
}: {
  recipients: Recipient[];
  setRecipients: (r: Recipient[]) => void;
  tags: { id: string; name: string }[];
}) {
  const [recipientTag, setRecipientTag] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [csv, setCsv] = useState<{ header: string[]; rows: string[][]; mapping: RecipientField[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function mergeAdd(incoming: Recipient[]) {
    const byEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));
    let added = 0, skipped = 0;
    for (const r of incoming) {
      const key = r.email.toLowerCase();
      if (!EMAIL_RE.test(key)) { skipped++; continue; }
      if (byEmail.has(key)) { skipped++; continue; }
      if (byEmail.size >= 10000) { skipped++; continue; }
      byEmail.set(key, r);
      added++;
    }
    setRecipients([...byEmail.values()]);
    toast.success(`${added} added${skipped ? `, ${skipped} skipped (dupes/invalid)` : ""}.`);
  }

  async function loadTag(tagId: string) {
    setRecipientTag(tagId);
    if (!tagId) return;
    setTagLoading(true);
    try { mergeAdd(await fetchRecipientsByTag(tagId)); }
    catch (e) { toast.error("Couldn't load contacts: " + (e as Error).message); }
    finally { setTagLoading(false); setRecipientTag(""); }
  }

  function onFile(file: File) {
    if (!/\.(csv|txt)$/i.test(file.name)) { toast.error("Please choose a .csv or .txt file."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      if (rows.length < 2) { toast.error("That file has no data rows."); return; }
      const header = rows[0];
      setCsv({ header, rows: rows.slice(1), mapping: header.map(guessField) });
    };
    reader.onerror = () => toast.error("Couldn't read the file.");
    reader.readAsText(file);
  }

  function importCsv() {
    if (!csv) return;
    const { recipients: recs, skipped } = rowsToRecipients(csv.rows, csv.mapping);
    if (!recs.length) { toast.error("Map a column to Email first."); return; }
    mergeAdd(recs);
    if (skipped) toast.info(`${skipped} rows skipped (invalid/duplicate email).`);
    setCsv(null);
  }

  function applyPasted() {
    const recs = pasted.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s)).map((email) => ({ email }));
    if (!recs.length) { toast.error("No valid emails found."); return; }
    mergeAdd(recs);
    setPasted("");
  }

  const hasEmailMapped = csv?.mapping.includes("email");
  const shown = showAll ? recipients : recipients.slice(0, 20);

  return (
    <div className="space-y-4">
      {/* Source 1: tag */}
      <div className="space-y-1">
        <Label className="text-xs">From a contact tag (custom list)</Label>
        <div className="flex items-center gap-2">
          <Select value={recipientTag} onValueChange={loadTag} disabled={tagLoading}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a tag…" /></SelectTrigger>
            <SelectContent>
              {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {tagLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-[11px] text-muted-foreground">Excludes Do-Not-Contact and No-Longer-Employed automatically.</p>
      </div>

      {/* Source 2: CSV upload */}
      <div className="space-y-1">
        <Label className="text-xs">Upload a list (CSV or .txt)</Label>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        <button
          type="button"
          className="w-full rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground hover:bg-accent/40"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        >
          <Upload className="h-5 w-5 mx-auto mb-1" />
          <span className="font-medium text-foreground">Click to upload</span> or drag & drop a CSV
        </button>

        {csv && (
          <div className="rounded-md border p-2 space-y-2">
            <p className="text-[11px] text-muted-foreground">Map your columns ({csv.rows.length} rows):</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {csv.header.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs flex-1 truncate" title={h}>{h || `Column ${i + 1}`}</span>
                  <Select value={csv.mapping[i]} onValueChange={(v) => {
                    const m = [...csv.mapping]; m[i] = v as RecipientField; setCsv({ ...csv, mapping: m });
                  }}>
                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={importCsv} disabled={!hasEmailMapped}>Import</Button>
              <Button size="sm" variant="ghost" onClick={() => setCsv(null)}>Cancel</Button>
              {!hasEmailMapped && <span className="text-[11px] text-amber-600">Map a column to Email.</span>}
            </div>
          </div>
        )}
      </div>

      {/* Source 3: paste */}
      <div className="space-y-1">
        <Label className="text-xs">Or paste emails</Label>
        <Textarea rows={2} placeholder="one@x.com, two@y.com…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <Button size="sm" variant="outline" onClick={applyPasted} disabled={!pasted.trim()}>Add pasted emails</Button>
      </div>

      {/* Recipient table */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{recipients.length} recipients</p>
          {recipients.length > 0 && (
            <Button size="xs" variant="ghost" className="text-destructive"
              onClick={() => { if (confirm("Clear all recipients?")) setRecipients([]); }}>Clear all</Button>
          )}
        </div>
        {recipients.length > 0 && (
          <div className="rounded-md border divide-y max-h-52 overflow-y-auto">
            {shown.map((r) => (
              <div key={r.email} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                <span className="truncate">
                  {r.email}
                  {(r.first_name || r.company_name) && (
                    <span className="text-muted-foreground"> · {[r.first_name, r.company_name].filter(Boolean).join(", ")}</span>
                  )}
                </span>
                <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setRecipients(recipients.filter((x) => x.email !== r.email))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {recipients.length > 20 && (
              <button type="button" className="w-full px-2 py-1 text-[11px] text-primary hover:underline"
                onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${recipients.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
