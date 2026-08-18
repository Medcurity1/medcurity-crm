// Campaign recipients picker — four sources that all accumulate (with
// dedup): a contact tag (custom list), a saved list (static or smart —
// Report Builder audiences arrive via its Save-as-list; outside-review
// I26), a CSV/.txt upload with column mapping, or pasted emails. Shows a
// managed recipient table.
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  fetchRecipientsByTag, fetchRecipientsByList, fetchSuppressionForEmails, fetchActiveEnrollmentsForEmails,
  type Recipient, type ActiveEnrollmentEntry,
} from "./api";
import { useLeadLists } from "@/features/lead-lists/lead-lists-api";
import { parseCsv, guessField, rowsToRecipients, FIELD_LABEL, type RecipientField } from "./csv";
import {
  partitionSuppression, groupSuppressionReasons, normalizeEmail, suppressionReasonLabel,
  isNonOverridableReason,
  type SuppressionEntry,
} from "./suppression";

const FIELD_OPTIONS: RecipientField[] = ["email", "first_name", "last_name", "full_name", "company_name", "skip"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Refuse a saved-list audience above this in one pick — matches the Lists
// page's own SMART_FETCH_CAP display ceiling; see loadList.
const LIST_AUDIENCE_CEILING = 2000;

export function CampaignRecipients({
  recipients, setRecipients, tags,
  suppression, setSuppression,
  suppressionOverrides, setSuppressionOverrides,
  activeEnrollments, setActiveEnrollments,
  enrollmentOverrides, setEnrollmentOverrides,
  compact = false,
  onChecksPendingChange,
  onChecksFailedChange,
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
  /** Right-click/contact-detail launches already know their audience. Keep
   *  the safety rails mounted, but replace the full audience builder with a
   *  compact, locked confirmation. */
  compact?: boolean;
  onChecksPendingChange?: (pending: boolean) => void;
  onChecksFailedChange?: (failed: boolean) => void;
}) {
  const [recipientTag, setRecipientTag] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [recipientList, setRecipientList] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const { data: lists, isError: listsError } = useLeadLists();
  // Latest recipients, readable synchronously — mergeAdd builds from this
  // instead of the render-closure prop so concurrent sources can't clobber
  // each other (see mergeAdd's comment).
  const recipientsRef = useRef(recipients);
  useEffect(() => { recipientsRef.current = recipients; }, [recipients]);
  const [pasted, setPasted] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [showAlreadyEnrolled, setShowAlreadyEnrolled] = useState(false);
  const [suppressionLoading, setSuppressionLoading] = useState(recipients.length > 0);
  const [enrollmentLoading, setEnrollmentLoading] = useState(recipients.length > 0);
  const [suppressionError, setSuppressionError] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState(false);
  const [safetyCheckNonce, setSafetyCheckNonce] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
    if (!recipients.length) {
      setSuppression([]); setSuppressionLoading(false); setSuppressionError(false); return;
    }
    setSuppressionLoading(true);
    setSuppressionError(false);
    fetchSuppressionForEmails(recipients.map((r) => r.email))
      .then((rows) => { if (suppressionReqId.current === id) setSuppression(rows); })
      .catch((e) => {
        if (suppressionReqId.current === id) {
          setSuppressionError(true);
          toast.error("Couldn't check the Do-Not-Email list: " + (e as Error).message);
        }
      })
      .finally(() => { if (suppressionReqId.current === id) setSuppressionLoading(false); });
  }, [recipients, setSuppression, safetyCheckNonce]);

  // Same pattern, checking "already actively enrolled elsewhere" instead.
  useEffect(() => {
    const id = ++enrollmentReqId.current;
    if (!recipients.length) {
      setActiveEnrollments([]); setEnrollmentLoading(false); setEnrollmentError(false); return;
    }
    setEnrollmentLoading(true);
    setEnrollmentError(false);
    fetchActiveEnrollmentsForEmails(recipients.map((r) => r.email))
      .then((rows) => { if (enrollmentReqId.current === id) setActiveEnrollments(rows); })
      .catch((e) => {
        if (enrollmentReqId.current === id) {
          setEnrollmentError(true);
          toast.error("Couldn't check existing enrollments: " + (e as Error).message);
        }
      })
      .finally(() => { if (enrollmentReqId.current === id) setEnrollmentLoading(false); });
  }, [recipients, setActiveEnrollments, safetyCheckNonce]);

  useEffect(() => {
    onChecksPendingChange?.(suppressionLoading || enrollmentLoading);
  }, [suppressionLoading, enrollmentLoading, onChecksPendingChange]);

  useEffect(() => {
    onChecksFailedChange?.(suppressionError || enrollmentError);
  }, [suppressionError, enrollmentError, onChecksFailedChange]);

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
    const reasons = reasonsByEmail.get(key);
    // A non-overridable reason (recorded unsubscribe / manual opt-out) can't
    // be included-anyway — mirrors partitionSuppression's lock, so this
    // summary count always matches what the launch will actually send.
    const okSuppression = !reasons || (overrideSet.has(key) && !reasons.some(isNonOverridableReason));
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
    // Built from the ref, not the closed-over prop (adversarial review):
    // two sources resolving concurrently — a slow saved-list load racing a
    // quick paste — would otherwise each merge into a stale snapshot and
    // the loser's additions would vanish under a "N added" success toast.
    const byEmail = new Map(recipientsRef.current.map((r) => [r.email.toLowerCase(), r]));
    let added = 0, skipped = 0, capped = 0;
    for (const r of incoming) {
      const key = r.email.toLowerCase();
      if (!EMAIL_RE.test(key)) { skipped++; continue; }
      if (byEmail.has(key)) { skipped++; continue; }
      if (byEmail.size >= 10000) { capped++; continue; }
      byEmail.set(key, r);
      added++;
    }
    setRecipients([...byEmail.values()]);
    // The cap is its own count (adversarial review) — a list blowing past
    // 10,000 is not "dupes/invalid" and must not be reported as such.
    let msg = `${added} added${skipped ? `, ${skipped} skipped (dupes/invalid)` : ""}.`;
    if (capped) msg += ` ${capped} not added. The 10,000-recipient limit was reached.`;
    if (added === 0 && !capped) toast.info(msg);
    else toast.success(msg);
  }

  async function loadTag(tagId: string) {
    setRecipientTag(tagId);
    if (!tagId) return;
    setTagLoading(true);
    try { mergeAdd(await fetchRecipientsByTag(tagId)); }
    catch (e) { toast.error("Couldn't load contacts: " + (e as Error).message); }
    finally { setTagLoading(false); setRecipientTag(""); }
  }

  async function loadList(listId: string) {
    setRecipientList(listId);
    if (!listId) return;
    const list = (lists ?? []).find((l) => l.id === listId);
    if (!list) { setRecipientList(""); return; }
    setListLoading(true);
    try {
      const recs = await fetchRecipientsByList(list);
      if (!recs.length) {
        toast.info(list.is_dynamic
          ? "That smart list matches nobody with an email right now."
          : "That list has no members with an email.");
      } else if (recs.length > LIST_AUDIENCE_CEILING) {
        // A broad smart rule ("everyone with an email") can legitimately
        // resolve to the whole CRM — refuse rather than pour an arbitrary
        // subset into a campaign (adversarial review). At this team's
        // sending rates an audience this size is a mistake, not a plan.
        toast.error(
          `That list has ${recs.length.toLocaleString()} people, too many for one campaign. ` +
          `Narrow the list (or split it) to under ${LIST_AUDIENCE_CEILING.toLocaleString()} and try again.`,
        );
      } else {
        mergeAdd(recs);
      }
    } catch (e) { toast.error("Couldn't load the list: " + (e as Error).message); }
    finally { setListLoading(false); setRecipientList(""); }
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

  function confirmClearAll() {
    setRecipients([]);
    setSuppressionOverrides([]);
    setEnrollmentOverrides([]);
    setClearConfirmOpen(false);
  }

  const hasEmailMapped = csv?.mapping.includes("email");
  const shown = showAll ? recipients : recipients.slice(0, 20);

  return (
    <div className="space-y-4">
      {compact && (
        <div className="rounded-lg border bg-muted/25 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Going to</p>
              <p className="text-sm font-semibold truncate">
                {recipients.length === 1
                  ? ([recipients[0].first_name, recipients[0].last_name].filter(Boolean).join(" ") || recipients[0].email)
                  : `${recipients.length} people`}
              </p>
              {recipients.length === 1 && (
                <p className="text-xs text-muted-foreground truncate">{recipients[0].email}</p>
              )}
            </div>
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Recipient locked
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Pulse checks Do-Not-Email status and other active campaigns automatically before launch.
          </p>
        </div>
      )}

      {!compact && <>
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

      {/* Source 1b: saved list (outside-review I26 — Report Builder
          audiences arrive here via its Save-as-list) */}
      {((lists ?? []).length > 0 || listsError) && (
        <div className="space-y-1">
          <Label className="text-xs">From a saved list</Label>
          {listsError ? (
            <p className="text-xs text-amber-600">Couldn't load your saved lists. Reopen this step to retry.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select value={recipientList} onValueChange={loadList} disabled={listLoading}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a list…" /></SelectTrigger>
                  <SelectContent>
                    {(lists ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}{l.is_dynamic ? " (smart, resolved when you pick it)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {listLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Built an audience in the Report Builder? Save it as a list there, then pick it here.
              </p>
            </>
          )}
        </div>
      )}

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
      </>}

      {/* Recipient table */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{recipients.length} recipients</p>
          {!compact && recipients.length > 0 && (
            <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setClearConfirmOpen(true)}>Clear all</Button>
          )}
        </div>

        {recipients.length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
            {suppressionLoading || enrollmentLoading ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Checking the Do-Not-Email list and existing enrollments…</>
            ) : suppressionError || enrollmentError ? (
              <>
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                <span className="font-medium text-amber-600">Safety check incomplete.</span>
                <Button type="button" size="xs" variant="outline" className="h-6" onClick={() => setSafetyCheckNonce((n) => n + 1)}>
                  Retry checks
                </Button>
              </>
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
                  {!compact && (
                    <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setRecipients(recipients.filter((x) => x.email !== r.email))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
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
                  const reasonCodes = reasonsByEmail.get(key) ?? [];
                  const reasons = reasonCodes.map(suppressionReasonLabel).join(" · ");
                  // Unsubscribed / manually opted-out people can't be
                  // included anyway — their choice, not ours. The server
                  // enforces the same rule regardless of what's sent.
                  const locked = reasonCodes.some(isNonOverridableReason);
                  const checked = overrideSet.has(key) && !locked;
                  return (
                    <label key={r.email} className={locked ? "flex items-center gap-2 px-2 py-1.5 text-xs" : "flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer"}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={(e) => toggleOverride(r.email, e.target.checked)}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {r.email}
                        <span className="text-muted-foreground"> · {reasons || "suppressed"}</span>
                      </span>
                      <span className={checked ? "shrink-0 text-[10px] font-medium text-emerald-600" : "shrink-0 text-[10px] font-medium text-muted-foreground"}>
                        {locked
                          ? (reasonCodes.includes("optout_unsubscribed") ? "Unsubscribed, can't include" : "Opted out, can't include")
                          : checked ? "Included anyway" : "Excluded"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground border-t">
              Checked people are added to the campaign anyway. Everyone else here is left out of the send.
              People who unsubscribed or opted out can't be included. That choice is theirs.
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
              Checked people are enrolled in this campaign too. Everyone else here is left out; they'll keep getting the campaign they're already in.
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear this audience?"
        description={`Remove all ${recipients.length} selected ${recipients.length === 1 ? "person" : "people"} from this campaign setup?`}
        confirmLabel="Clear audience"
        onConfirm={confirmClearAll}
        destructive
      />
    </div>
  );
}
