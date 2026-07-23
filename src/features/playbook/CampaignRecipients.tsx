// Campaign recipients picker — three sources that all accumulate (with
// dedup): a contact tag (custom list), a CSV/.txt upload with column mapping,
// or pasted emails. Shows a managed recipient table.
//
// Every source feeds the SAME Do-Not-Email safety check (2026-07-22): once
// the recipient list is built/deduped, every email is checked against
// v_marketing_suppression. Suppressed people are excluded from the list this
// component hands to the wizard unless the user deliberately checks
// "Include anyway" for that specific person — see suppression.ts for the
// partition logic (also mirrored server-side in playbook-smartlead/index.ts
// as a defense-in-depth re-check before anything is sent).
//
// S3 (2026-07-22) adds a SECOND, identically-shaped soft-alert rail: is this
// email already actively enrolled in another campaign? Reuses the exact same
// partitionSuppression/groupSuppressionReasons helpers (an "already
// enrolled" row is structurally just a {email, reason} row where reason =
// the other campaign's name) rather than duplicating the logic.

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Loader2, ShieldAlert, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  fetchRecipientsByTag, fetchSuppressionForEmails, fetchActiveEnrollmentsForEmails,
  type Recipient, type ActiveEnrollmentEntry,
} from "./api";
import { parseCsv, guessField, rowsToRecipients, FIELD_LABEL, type RecipientField } from "./csv";
import {
  partitionSuppression, groupSuppressionReasons, normalizeEmail, suppressionReasonLabel,
  type SuppressionEntry,
} from "./suppression";

const FIELD_OPTIONS: RecipientField[] = ["email", "first_name", "last_name", "company_name", "skip"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CampaignRecipients({
  recipients, setRecipients, tags,
  suppression, setSuppression,
  suppressionOverrides, setSuppressionOverrides,
  activeEnrollments, setActiveEnrollments,
  enrollmentOverrides, setEnrollmentOverrides,
}: {
  recipients: Recipient[];
  setRecipients: (r: Recipient[]) => void;
  tags: { id: string; name: string }[];
  suppression: SuppressionEntry[];
  setSuppression: (rows: SuppressionEntry[]) => void;
  suppressionOverrides: string[];
  setSuppressionOverrides: (emails: string[]) => void;
  activeEnrollments: ActiveEnrollmentEntry[];
  setActiveEnrollments: (rows: ActiveEnrollmentEntry[]) => void;
  enrollmentOverrides: string[];
  setEnrollmentOverrides: (emails: string[]) => void;
}) {
  const [recipientTag, setRecipientTag] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [showAlreadyEnrolled, setShowAlreadyEnrolled] = useState(false);
  const [suppressionLoading, setSuppressionLoading] = useState(false);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [csv, setCsv] = useState<{ header: string[]; rows: string[][]; mapping: RecipientField[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const suppressionReqId = useRef(0);
  const enrollmentReqId = useRef(0);

  // Re-check the Do-Not-Email list any time the built/deduped recipient list
  // changes — covers all three sources, since they all funnel through
  // mergeAdd -> setRecipients. "Latest request wins" guard so a fast second
  // merge (e.g. upload a CSV, then immediately paste more) can't have its
  // result clobbered by a slower earlier response.
  useEffect(() => {
    const id = ++suppressionReqId.current;
    if (!recipients.length) { setSuppression([]); return; }
    setSuppressionLoading(true);
    fetchSuppressionForEmails(recipients.map((r) => r.email))
      .then((rows) => { if (suppressionReqId.current === id) setSuppression(rows); })
      .catch((e) => {
        if (suppressionReqId.current === id) {
          toast.error("Couldn't check the Do-Not-Email list: " + (e as Error).message);
        }
      })
      .finally(() => { if (suppressionReqId.current === id) setSuppressionLoading(false); });
  }, [recipients, setSuppression]);

  // Same pattern, checking "already actively enrolled elsewhere" instead.
  useEffect(() => {
    const id = ++enrollmentReqId.current;
    if (!recipients.length) { setActiveEnrollments([]); return; }
    setEnrollmentLoading(true);
    fetchActiveEnrollmentsForEmails(recipients.map((r) => r.email))
      .then((rows) => { if (enrollmentReqId.current === id) setActiveEnrollments(rows); })
      .catch((e) => {
        if (enrollmentReqId.current === id) {
          toast.error("Couldn't check existing enrollments: " + (e as Error).message);
        }
      })
      .finally(() => { if (enrollmentReqId.current === id) setEnrollmentLoading(false); });
  }, [recipients, setActiveEnrollments]);

  const partition = useMemo(
    () => partitionSuppression(recipients, (r) => r.email, suppression, suppressionOverrides),
    [recipients, suppression, suppressionOverrides],
  );
  const reasonsByEmail = useMemo(() => groupSuppressionReasons(suppression), [suppression]);
  const overrideSet = useMemo(
    () => new Set(suppressionOverrides.map(normalizeEmail)),
    [suppressionOverrides],
  );
  const suppressedAll = useMemo(
    () => [...partition.dropped, ...partition.overridden].sort((a, b) => a.email.localeCompare(b.email)),
    [partition],
  );

  // "Already enrolled elsewhere" rows, reshaped to {email, reason} so the
  // exact same partition/group helpers the suppression rail uses apply here
  // too — `reason` is the other campaign's name.
  const enrollmentAsRows = useMemo<SuppressionEntry[]>(
    () => activeEnrollments.map((e) => ({ email: e.email, reason: e.campaign_name })),
    [activeEnrollments],
  );
  const enrollmentPartition = useMemo(
    () => partitionSuppression(recipients, (r) => r.email, enrollmentAsRows, enrollmentOverrides),
    [recipients, enrollmentAsRows, enrollmentOverrides],
  );
  const enrollmentReasonsByEmail = useMemo(() => groupSuppressionReasons(enrollmentAsRows), [enrollmentAsRows]);
  const enrollmentOverrideSet = useMemo(
    () => new Set(enrollmentOverrides.map(normalizeEmail)),
    [enrollmentOverrides],
  );
  const alreadyEnrolledAll = useMemo(
    () => [...enrollmentPartition.dropped, ...enrollmentPartition.overridden].sort((a, b) => a.email.localeCompare(b.email)),
    [enrollmentPartition],
  );

  // "Sendable" here means it clears BOTH rails — used only for this
  // component's own summary line; the wizard (CampaignWizard.tsx) computes
  // its own combined recipient list from the same raw props for the actual
  // launch payload, so the two can never disagree.
  const sendableCount = recipients.filter((r) => {
    const key = normalizeEmail(r.email);
    const okSuppression = !reasonsByEmail.has(key) || overrideSet.has(key);
    const okEnrollment = !enrollmentReasonsByEmail.has(key) || enrollmentOverrideSet.has(key);
    return okSuppression && okEnrollment;
  }).length;
  const suppressedCount = partition.dropped.length + partition.overridden.length;
  const alreadyEnrolledCount = enrollmentPartition.dropped.length + enrollmentPartition.overridden.length;

  function toggleOverride(email: string, checked: boolean) {
    const key = normalizeEmail(email);
    const set = new Set(suppressionOverrides.map(normalizeEmail));
    if (checked) set.add(key); else set.delete(key);
    setSuppressionOverrides([...set]);
  }

  function toggleEnrollmentOverride(email: string, checked: boolean) {
    const key = normalizeEmail(email);
    const set = new Set(enrollmentOverrides.map(normalizeEmail));
    if (checked) set.add(key); else set.delete(key);
    setEnrollmentOverrides([...set]);
  }

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

  function clearAll() {
    if (!confirm("Clear all recipients?")) return;
    setRecipients([]);
    setSuppressionOverrides([]);
    setEnrollmentOverrides([]);
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
        <p className="text-[11px] text-muted-foreground">Do-Not-Email people are checked after you add them, below.</p>
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
            <Button size="xs" variant="ghost" className="text-destructive" onClick={clearAll}>Clear all</Button>
          )}
        </div>

        {recipients.length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
            {suppressionLoading || enrollmentLoading ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Checking the Do-Not-Email list and existing enrollments…</>
            ) : (
              <>
                {recipients.length} selected → <span className="font-medium text-foreground">{sendableCount} eligible</span>
                {suppressedCount > 0 && (
                  <>
                    {" "}· <span className="font-medium text-amber-600">{suppressedCount} on the Do-Not-Email list</span>
                    {partition.overridden.length > 0 && ` (${partition.overridden.length} included anyway)`}
                  </>
                )}
                {alreadyEnrolledCount > 0 && (
                  <>
                    {" "}· <span className="font-medium text-amber-600">{alreadyEnrolledCount} already enrolled elsewhere</span>
                    {enrollmentPartition.overridden.length > 0 && ` (${enrollmentPartition.overridden.length} enrolled anyway)`}
                  </>
                )}
              </>
            )}
          </p>
        )}

        {recipients.length > 0 && (
          <div className="rounded-md border divide-y max-h-52 overflow-y-auto">
            {shown.map((r) => {
              const key = normalizeEmail(r.email);
              const isSuppressed = reasonsByEmail.has(key);
              const isOverridden = overrideSet.has(key);
              const isAlreadyEnrolled = enrollmentReasonsByEmail.has(key);
              const isEnrollOverridden = enrollmentOverrideSet.has(key);
              return (
                <div key={r.email} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                  <span className="truncate">
                    {r.email}
                    {(r.first_name || r.company_name) && (
                      <span className="text-muted-foreground"> · {[r.first_name, r.company_name].filter(Boolean).join(", ")}</span>
                    )}
                    {isSuppressed && (
                      <span className={isOverridden ? "ml-1 text-[10px] text-emerald-600" : "ml-1 text-[10px] text-amber-600"}>
                        {isOverridden ? "· included anyway" : "· Do-Not-Email"}
                      </span>
                    )}
                    {isAlreadyEnrolled && (
                      <span className={isEnrollOverridden ? "ml-1 text-[10px] text-emerald-600" : "ml-1 text-[10px] text-amber-600"}>
                        {isEnrollOverridden ? "· enrolled anyway" : "· already enrolled"}
                      </span>
                    )}
                  </span>
                  <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setRecipients(recipients.filter((x) => x.email !== r.email))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {recipients.length > 20 && (
              <button type="button" className="w-full px-2 py-1 text-[11px] text-primary hover:underline"
                onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${recipients.length}`}
              </button>
            )}
          </div>
        )}

        {suppressedCount > 0 && (
          <div className="rounded-md border">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium hover:bg-accent/40"
              onClick={() => setShowSuppressed((v) => !v)}
            >
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                Review {suppressedCount} on the Do-Not-Email list
              </span>
              <span className="text-muted-foreground">{showSuppressed ? "Hide" : "Show"}</span>
            </button>
            {showSuppressed && (
              <div className="divide-y max-h-52 overflow-y-auto border-t">
                {suppressedAll.map((r) => {
                  const key = normalizeEmail(r.email);
                  const reasons = (reasonsByEmail.get(key) ?? []).map(suppressionReasonLabel).join(" · ");
                  const checked = overrideSet.has(key);
                  return (
                    <label key={r.email} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleOverride(r.email, e.target.checked)}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {r.email}
                        <span className="text-muted-foreground"> · {reasons || "suppressed"}</span>
                      </span>
                      <span className={checked ? "shrink-0 text-[10px] font-medium text-emerald-600" : "shrink-0 text-[10px] font-medium text-muted-foreground"}>
                        {checked ? "Included anyway" : "Excluded"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground border-t">
              Checked people are added to the campaign anyway. Everyone else here is left out of the send.
            </p>
          </div>
        )}

        {alreadyEnrolledCount > 0 && (
          <div className="rounded-md border">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium hover:bg-accent/40"
              onClick={() => setShowAlreadyEnrolled((v) => !v)}
            >
              <span className="inline-flex items-center gap-1">
                <Users2 className="h-3.5 w-3.5 text-amber-600" />
                Review {alreadyEnrolledCount} already enrolled elsewhere
              </span>
              <span className="text-muted-foreground">{showAlreadyEnrolled ? "Hide" : "Show"}</span>
            </button>
            {showAlreadyEnrolled && (
              <div className="divide-y max-h-52 overflow-y-auto border-t">
                {alreadyEnrolledAll.map((r) => {
                  const key = normalizeEmail(r.email);
                  const campaignNames = (enrollmentReasonsByEmail.get(key) ?? []).join(" · ");
                  const checked = enrollmentOverrideSet.has(key);
                  return (
                    <label key={r.email} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleEnrollmentOverride(r.email, e.target.checked)}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {r.email}
                        <span className="text-muted-foreground"> · already in: {campaignNames || "another campaign"}</span>
                      </span>
                      <span className={checked ? "shrink-0 text-[10px] font-medium text-emerald-600" : "shrink-0 text-[10px] font-medium text-muted-foreground"}>
                        {checked ? "Enrolled anyway" : "Excluded"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground border-t">
              Checked people are enrolled in this campaign too. Everyone else here is left out — they'll keep getting the campaign they're already in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
