import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  UploadCloud, ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle,
  Loader2, Users, RefreshCw, CalendarPlus, Loader,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { parseCsv } from "@/features/playbook/csv";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUsers } from "@/features/accounts/api";
import {
  guessContactField,
  parseBoolish,
  primaryEmailOf,
  CONTACT_FIELD_LABEL,
  CONTACT_FIELD_ORDER,
  type ContactField,
} from "./contactImportFields";
import {
  useImportContacts,
  emptyResult,
  addResult,
  type ContactImportRow,
  type ContactImportOptions,
  type ContactImportResult,
} from "./importContactsApi";

// Real run does dedup + account match/create + insert (+ maybe an activity)
// per row, so keep batches small like the promote tool. Preview is lighter.
const RUN_CHUNK = 200;
const PREVIEW_CHUNK = 500;

const EVENT_TYPES = [
  { value: "webinar", label: "Webinar" },
  { value: "conference", label: "Conference" },
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
];

type Step = 1 | 2 | 3 | 4;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function ContactImportWizard({
  open,
  onOpenChange,
  penMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Land NEW people in the Imports pen (import_status='pending') instead
   * of creating live contacts + accounts. Used by the Imports tab. */
  penMode?: boolean;
}) {
  const { profile } = useAuth();
  const { data: users } = useUsers();
  const qc = useQueryClient();
  const importer = useImportContacts();

  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ContactField[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [dupMode, setDupMode] = useState<"skip" | "update">("skip");
  const [ownerId, setOwnerId] = useState<string>("");
  const [eventOn, setEventOn] = useState(false);
  const [eventType, setEventType] = useState("webinar");
  const [eventSubject, setEventSubject] = useState("");
  const [eventDate, setEventDate] = useState("");

  const [preview, setPreview] = useState<ContactImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const effectiveOwner = ownerId || profile?.id || "";

  function reset() {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setDataRows([]);
    setMapping([]);
    setParseError(null);
    setDupMode("skip");
    setOwnerId("");
    setEventOn(false);
    setEventType("webinar");
    setEventSubject("");
    setEventDate("");
    setPreview(null);
    setPreviewing(false);
    setRunning(false);
    setProgress(null);
    setResult(null);
    setConfirmOpen(false);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setParseError("That file doesn't have a header row and at least one data row.");
        return;
      }
      const hdr = rows[0];
      setHeaders(hdr);
      setDataRows(rows.slice(1));
      setMapping(hdr.map((h) => guessContactField(h)));
      setFileName(file.name);
      setPreview(null);
      setResult(null);
      setStep(2);
    } catch (err) {
      setParseError("Couldn't read the file: " + (err as Error).message);
    }
  }

  // Build the payload: apply the mapping, coerce do_not_contact, and dedup
  // the file against itself by primary email (keep first) so the file can't
  // create duplicates of its own rows.
  function buildRows(): ContactImportRow[] {
    const seen = new Set<string>();
    const out: ContactImportRow[] = [];
    for (const row of dataRows) {
      const rec: ContactImportRow = {};
      mapping.forEach((field, i) => {
        if (field === "skip") return;
        const raw = (row[i] ?? "").trim();
        if (!raw) return;
        if (field === "do_not_contact") {
          if (parseBoolish(raw)) rec.do_not_contact = true;
          return;
        }
        if (rec[field] == null || rec[field] === "") rec[field] = raw;
      });
      const primary = primaryEmailOf(rec as Record<string, unknown>);
      if (primary) {
        if (seen.has(primary)) continue;
        seen.add(primary);
      }
      out.push(rec);
    }
    return out;
  }

  function buildOptions(): ContactImportOptions {
    return {
      dup_mode: dupMode,
      pen: penMode || undefined,
      owner_user_id: effectiveOwner || null,
      event: eventOn
        ? {
            enabled: true,
            type: eventType,
            subject: eventSubject.trim(),
            // Anchor to local noon so the event lands on the intended day
            // regardless of the viewer's timezone (matches ActivityForm).
            date: eventDate ? new Date(`${eventDate}T12:00:00`).toISOString() : new Date().toISOString(),
          }
        : null,
    };
  }

  async function runPreview() {
    if (previewing) return; // a second concurrent preview would race the first
    const rows = buildRows();
    const options = buildOptions();
    setPreviewing(true);
    setPreview(null);
    let agg = emptyResult(true);
    try {
      for (const batch of chunk(rows, PREVIEW_CHUNK)) {
        const r = await importer.mutateAsync({ rows: batch, options, dryRun: true });
        agg = addResult(agg, r);
      }
      setPreview(agg);
    } catch (err) {
      toast.error("Preview failed: " + (err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    const rows = buildRows();
    const options = buildOptions();
    setRunning(true);
    setProgress({ done: 0, total: rows.length });
    let agg = emptyResult(false);
    try {
      let done = 0;
      for (const batch of chunk(rows, RUN_CHUNK)) {
        const r = await importer.mutateAsync({ rows: batch, options, dryRun: false });
        agg = addResult(agg, r);
        done += batch.length;
        setProgress({ done, total: rows.length });
      }
      setResult(agg);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["imports-pen"] });
      toast.success(
        penMode
          ? `${agg.created.toLocaleString()} landed in Imports · ${agg.updated.toLocaleString()} updated existing · ${agg.skipped.toLocaleString()} already contacts`
          : `Imported ${agg.created.toLocaleString()} new · ${agg.updated.toLocaleString()} updated` +
              (agg.events_stamped ? ` · ${agg.events_stamped.toLocaleString()} events logged` : ""),
      );
    } catch (err) {
      toast.error("Import failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const hasLastName = mapping.includes("last_name");
  const hasEmail = mapping.includes("email");
  const eventValid = !eventOn || (eventSubject.trim().length > 0 && !!eventDate);
  const rowCount = dataRows.length;

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UploadCloud className="h-5 w-5 text-indigo-600" />
              {penMode ? "Import a List" : "Import Contacts"} {result ? "" : `— Step ${step} of 4`}
            </DialogTitle>
            <DialogDescription>
              {step === 1 &&
                (penMode
                  ? "Upload a CSV of people. New ones land in the Imports pen for cleanup; anyone already a contact is matched by email."
                  : "Upload a CSV of people. We'll match them to your contacts by email.")}
              {step === 2 && "Tell us which column is which. We guessed based on the headers."}
              {step === 3 && "Choose how to handle duplicates — and optionally log an event for everyone."}
              {step === 4 && !result && "Review what will happen, then import."}
              {result && "Import complete."}
            </DialogDescription>
          </DialogHeader>

          {/* step dots */}
          {!result && (
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className={
                    "h-1.5 flex-1 rounded-full transition-colors " +
                    (n < step ? "bg-primary" : n === step ? "bg-primary/60" : "bg-muted")
                  }
                />
              ))}
            </div>
          )}

          <div className="min-h-[280px] py-2">
            {/* ── STEP 1: UPLOAD ── */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upload a <span className="font-medium">.csv</span> file — for example a webinar
                  attendee list or an event registration export. The first row should be column headers.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="contact-import-file">CSV file</Label>
                  <Input id="contact-import-file" type="file" accept=".csv,text/csv" onChange={onFile} />
                </div>
                {parseError && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {parseError}
                  </div>
                )}
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  New people become contacts (matching or creating their account by company name).
                  Anyone already in your CRM is matched by email — you'll choose whether to update or skip them.
                </div>
              </div>
            )}

            {/* ── STEP 2: MAP COLUMNS ── */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{fileName}</span> · {rowCount.toLocaleString()} rows · {headers.length} columns
                </div>
                <div className="max-h-[46vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CSV column</TableHead>
                        <TableHead>First value</TableHead>
                        <TableHead className="w-[220px]">Maps to</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {headers.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{h || <span className="text-muted-foreground">(blank)</span>}</TableCell>
                          <TableCell className="max-w-[180px] truncate text-muted-foreground">
                            {dataRows[0]?.[i] || "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={mapping[i] ?? "skip"}
                              onValueChange={(v) =>
                                setMapping((m) => m.map((f, idx) => (idx === i ? (v as ContactField) : f)))
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONTACT_FIELD_ORDER.map((f) => (
                                  <SelectItem key={f} value={f}>
                                    {CONTACT_FIELD_LABEL[f]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!hasLastName && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    Map one column to <span className="font-medium">Last Name</span> — it's required to create a contact.
                  </div>
                )}
                {hasLastName && !hasEmail && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    No <span className="font-medium">Email</span> column mapped — without it we can't match against existing
                    contacts, so everyone will be created as new (and re-imports would duplicate them).
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: OPTIONS ── */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>When a person already exists (matched by email)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDupMode("skip")}
                      className={
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors " +
                        (dupMode === "skip" ? "border-primary bg-primary/5" : "hover:bg-muted/50")
                      }
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Users className="h-4 w-4" /> Skip them
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Leave existing contacts untouched. Recommended.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDupMode("update")}
                      className={
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors " +
                        (dupMode === "update" ? "border-primary bg-primary/5" : "hover:bg-muted/50")
                      }
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <RefreshCw className="h-4 w-4" /> Fill in blanks
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Update only fields that are currently empty. Never overwrites existing data.
                      </span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-owner">Assign new contacts to</Label>
                  <Select value={effectiveOwner} onValueChange={setOwnerId}>
                    <SelectTrigger id="import-owner">
                      <SelectValue placeholder="Choose an owner" />
                    </SelectTrigger>
                    <SelectContent>
                      {(users ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name || u.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="flex items-center gap-2">
                        <CalendarPlus className="h-4 w-4 text-indigo-600" /> Log an event for everyone
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Adds one activity to every contact in this list — e.g. a webinar they attended.
                      </p>
                    </div>
                    <Switch checked={eventOn} onCheckedChange={setEventOn} />
                  </div>
                  {eventOn && (
                    <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="event-type" className="text-xs">Type</Label>
                        <Select value={eventType} onValueChange={setEventType}>
                          <SelectTrigger id="event-type" className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="event-subject" className="text-xs">Name</Label>
                        <Input
                          id="event-subject"
                          className="h-9"
                          placeholder="MedCycle Webinar"
                          value={eventSubject}
                          onChange={(e) => setEventSubject(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="event-date" className="text-xs">Date</Label>
                        <Input
                          id="event-date"
                          className="h-9"
                          type="date"
                          value={eventDate}
                          onChange={(e) => setEventDate(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 4: REVIEW + RUN / SUCCESS ── */}
            {step === 4 && !result && (
              <div className="space-y-4">
                {previewing && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking your list against existing contacts…
                  </div>
                )}
                {!previewing && preview && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatBox label="New contacts" value={preview.will_create} accent="emerald" />
                      <StatBox
                        label={dupMode === "update" ? "Existing updated" : "Existing skipped"}
                        value={dupMode === "update" ? preview.will_update : preview.will_skip}
                        accent="sky"
                      />
                      {eventOn && <StatBox label="Events logged" value={preview.will_stamp} accent="indigo" />}
                      {preview.invalid > 0 && <StatBox label="Skipped (no name)" value={preview.invalid} accent="amber" />}
                    </div>
                    {preview.ambiguous_account > 0 && (
                      <div className="rounded-md border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                        {preview.ambiguous_account.toLocaleString()} contact(s) will be created without an account
                        because their company name matches more than one account — you can assign those manually after.
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {dupMode === "update"
                        ? "Existing contacts will only have their blank fields filled — nothing is overwritten."
                        : "Existing contacts won't be changed"}
                      {eventOn ? `; everyone matched still gets the "${eventSubject.trim()}" ${eventType} logged.` : "."}
                    </p>
                  </div>
                )}
                {running && progress && (
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Importing {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUCCESS */}
            {result && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <div className="text-lg font-semibold">Import complete</div>
                <div className="text-sm text-muted-foreground">
                  {result.created.toLocaleString()} new contacts ·{" "}
                  {result.updated.toLocaleString()} updated ·{" "}
                  {result.skipped.toLocaleString()} skipped
                  {result.invalid > 0 && <> · {result.invalid.toLocaleString()} skipped (no name)</>}
                  {result.events_stamped > 0 && <> · {result.events_stamped.toLocaleString()} events logged</>}
                </div>
                {result.errors > 0 && (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" /> {result.errors.toLocaleString()} row(s) had errors
                    {result.last_error ? ` (${result.last_error})` : ""}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          {!result && (
            <div className="flex items-center justify-between border-t pt-4">
              <div>
                {step > 1 && (
                  <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={running || previewing}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step === 2 && (
                  <Button onClick={() => setStep(3)} disabled={!hasLastName}>
                    Next <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {step === 3 && (
                  <Button
                    onClick={() => {
                      setStep(4);
                      runPreview();
                    }}
                    disabled={!eventValid || previewing}
                  >
                    Review <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {step === 4 && (
                  <Button
                    onClick={() => setConfirmOpen(true)}
                    disabled={previewing || running || !preview || preview.total - preview.invalid <= 0}
                  >
                    {running ? <Loader className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Import {preview ? (preview.will_create + preview.will_update).toLocaleString() : ""} contacts
                  </Button>
                )}
              </div>
            </div>
          )}
          {result && (
            <div className="flex justify-end border-t pt-4">
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Run this import?"
        description={
          `${preview?.will_create.toLocaleString() ?? 0} new contact(s) will be created` +
          (dupMode === "update"
            ? `, ${preview?.will_update.toLocaleString() ?? 0} existing filled in`
            : `, ${preview?.will_skip.toLocaleString() ?? 0} existing skipped`) +
          (eventOn ? `, and the ${eventType} logged on ${preview?.will_stamp.toLocaleString() ?? 0} people` : "") +
          ". This runs immediately."
        }
        confirmLabel="Import"
        onConfirm={runImport}
      />
    </>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "sky" | "indigo" | "amber";
}) {
  const tint: Record<string, string> = {
    emerald: "border-emerald-300/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200",
    sky: "border-sky-300/50 bg-sky-50 text-sky-800 dark:bg-sky-950/20 dark:text-sky-200",
    indigo: "border-indigo-300/50 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/20 dark:text-indigo-200",
    amber: "border-amber-300/50 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200",
  };
  return (
    <div className={"rounded-lg border p-3 " + tint[accent]}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
