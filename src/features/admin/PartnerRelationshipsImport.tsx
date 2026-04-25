import { useState, useRef, useCallback } from "react";
import { Upload, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Partner Relationships import — UI mirror of
 * scripts/migration/import-partner-relationships.mjs
 *
 * SF stores account-to-account partnerships in the Partner object.
 * Each pair appears TWICE (once in each direction). We dedup on
 * import so each CRM relationship is recorded once.
 *
 * Direction convention: SF AccountFromId = PARTNER side
 * (umbrella/referrer); AccountToId = MEMBER. Both rows of each SF
 * mirror pair collapse to a single CRM row.
 *
 * Idempotent: re-runnable safely. Existing pairs are skipped via
 * the unique constraint on (partner_account_id, member_account_id).
 */

interface ImportStats {
  csvRows: number;
  skippedDeleted: number;
  skippedSelfRef: number;
  skippedNoMatch: number;
  uniquePairs: number;
  inserted: number;
  duplicates: number;
  errors: number;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        if (c === "\r") i++;
      } else cur += c;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function fetchAllAccountSfIdMap(): Promise<Map<string, string>> {
  const all: { id: string; sf_id: string }[] = [];
  let from = 0;
  const pageSize = 1000;
  // hard cap so a runaway loop can't melt
  while (all.length < 100_000) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, sf_id")
      .not("sf_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; sf_id: string }[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return new Map(all.map((a) => [a.sf_id, a.id]));
}

export function PartnerRelationshipsImport() {
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const log = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(reader.result as string);
      setCsvName(file.name);
      setStats(null);
      setLogs([]);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!csvText) return;
    setRunning(true);
    setLogs([]);
    setStats(null);

    try {
      log(`Loading ${csvName}…`);
      const rows = parseCSV(csvText);
      if (rows.length < 2) throw new Error("CSV is empty");

      const headers = rows[0];
      const idx = (n: string) =>
        headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
      const fromI = idx("AccountFromId");
      const toI = idx("AccountToId");
      const roleI = idx("Role");
      const isDelI = idx("IsDeleted");
      if (fromI < 0 || toI < 0)
        throw new Error("CSV must have AccountFromId and AccountToId columns");

      const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ""));
      log(`  ${dataRows.length.toLocaleString()} rows in CSV`);

      log("Loading account sf_id → uuid map…");
      const accountMap = await fetchAllAccountSfIdMap();
      log(`  ${accountMap.size.toLocaleString()} accounts indexed`);

      log("Resolving + deduping…");
      let skippedDeleted = 0;
      let skippedSelfRef = 0;
      let skippedNoMatch = 0;
      const seen = new Set<string>();
      const records: {
        partner_account_id: string;
        member_account_id: string;
        role: string | null;
      }[] = [];
      for (const r of dataRows) {
        if (isDelI >= 0 && r[isDelI] === "true") {
          skippedDeleted++;
          continue;
        }
        const fromSf = r[fromI]?.trim();
        const toSf = r[toI]?.trim();
        if (!fromSf || !toSf) {
          skippedNoMatch++;
          continue;
        }
        if (fromSf === toSf) {
          skippedSelfRef++;
          continue;
        }
        const partnerId = accountMap.get(fromSf);
        const memberId = accountMap.get(toSf);
        if (!partnerId || !memberId) {
          skippedNoMatch++;
          continue;
        }
        const key = `${partnerId}|${memberId}`;
        const reverseKey = `${memberId}|${partnerId}`;
        if (seen.has(key) || seen.has(reverseKey)) continue;
        seen.add(key);
        records.push({
          partner_account_id: partnerId,
          member_account_id: memberId,
          role: r[roleI]?.trim() || null,
        });
      }
      log(
        `  ${records.length.toLocaleString()} unique pairs (skipped ${skippedDeleted} deleted, ${skippedSelfRef} self-refs, ${skippedNoMatch} no-match)`,
      );

      log("Inserting…");
      const BATCH = 500;
      let inserted = 0;
      let duplicates = 0;
      let errors = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        const { error, count } = await supabase
          .from("account_partners")
          .upsert(chunk, {
            onConflict: "partner_account_id,member_account_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          log(`  batch ${i / BATCH + 1}: ${error.message}`);
          errors += chunk.length;
        } else {
          const ins = count ?? chunk.length;
          inserted += ins;
          duplicates += chunk.length - ins;
        }
        log(`  ${(i + chunk.length).toLocaleString()}/${records.length.toLocaleString()}`);
      }

      const finalStats: ImportStats = {
        csvRows: dataRows.length,
        skippedDeleted,
        skippedSelfRef,
        skippedNoMatch,
        uniquePairs: records.length,
        inserted,
        duplicates,
        errors,
      };
      setStats(finalStats);
      log(`Done. ${inserted} new · ${duplicates} duplicates · ${errors} errors.`);
      if (errors > 0) {
        toast.error(`Imported with ${errors} errors`);
      } else {
        toast.success(`Imported ${inserted} new partnerships`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${msg}`);
      toast.error(`Import failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Partner Relationships Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            Upload your Salesforce <code className="px-1 bg-muted rounded">Partner.csv</code> export.
            Each row links two accounts via <code>AccountFromId</code> (partner) and{" "}
            <code>AccountToId</code> (member). SF stores each pair twice; the importer dedups
            mirror pairs automatically.
          </p>
          <p>Re-runnable safely — existing pairs are skipped.</p>
        </div>

        <div>
          <Label htmlFor="partner-csv-file">CSV file</Label>
          <Input
            ref={fileInputRef}
            id="partner-csv-file"
            type="file"
            accept=".csv"
            onChange={onFileChange}
            disabled={running}
            className="mt-1 max-w-md"
          />
          {csvName && !running && (
            <p className="text-xs text-muted-foreground mt-1">
              Loaded: <strong>{csvName}</strong>
            </p>
          )}
        </div>

        <Button onClick={runImport} disabled={!csvText || running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing…
            </>
          ) : (
            "Run import"
          )}
        </Button>

        {stats && (
          <div className="rounded border p-3 text-sm space-y-1">
            <div className="font-semibold flex items-center gap-1">
              {stats.errors > 0 ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              Result
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>CSV rows</span><span className="font-mono">{stats.csvRows.toLocaleString()}</span>
              <span>Unique pairs</span><span className="font-mono">{stats.uniquePairs.toLocaleString()}</span>
              <span className="text-green-700">Newly inserted</span><span className="font-mono text-green-700">{stats.inserted.toLocaleString()}</span>
              <span>Already existed</span><span className="font-mono">{stats.duplicates.toLocaleString()}</span>
              <span className="text-amber-700">Skipped: deleted</span><span className="font-mono text-amber-700">{stats.skippedDeleted.toLocaleString()}</span>
              <span className="text-amber-700">Skipped: self-ref</span><span className="font-mono text-amber-700">{stats.skippedSelfRef.toLocaleString()}</span>
              <span className="text-amber-700">Skipped: no-match account</span><span className="font-mono text-amber-700">{stats.skippedNoMatch.toLocaleString()}</span>
              {stats.errors > 0 && (
                <>
                  <span className="text-destructive">Errors</span>
                  <span className="font-mono text-destructive">{stats.errors.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Run log ({logs.length} lines)
            </summary>
            <pre className="mt-2 text-xs bg-muted p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">
              {logs.join("\n")}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
