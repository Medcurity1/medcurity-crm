import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

/* ================================================================
   Types
   ================================================================ */

type EntityType = "accounts" | "contacts" | "opportunities" | "leads";

interface ColumnMapping {
  csvColumn: string;
  crmField: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/* ================================================================
   CSV Parser - handles quoted fields, newlines inside quotes, etc.
   ================================================================ */

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip next quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        current = "";
        if (ch === "\r") i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field / row
  row.push(current.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

/* ================================================================
   Field mappings per entity
   ================================================================ */

const ACCOUNT_FIELDS: Record<string, string> = {
  "account name": "name",
  "account id": "sf_id",
  industry: "industry",
  website: "website",
  phone: "notes",
  "billing street": "billing_street",
  "billing city": "billing_city",
  "billing state/province": "billing_state",
  "billing state": "billing_state",
  "billing zip/postal code": "billing_zip",
  "billing zip": "billing_zip",
  "billing country": "billing_country",
  "account owner": "owner_user_id",
  type: "account_type",
  "annual revenue": "annual_revenue",
  employees: "employees",
};

const CONTACT_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  title: "title",
  phone: "phone",
  "account id": "account_id_sf_lookup",
  "contact id": "sf_id",
};

const OPPORTUNITY_FIELDS: Record<string, string> = {
  "opportunity name": "name",
  "account id": "account_id_sf_lookup",
  stage: "stage",
  amount: "amount",
  "close date": "close_date",
  "opportunity id": "sf_id",
  type: "kind",
};

const LEAD_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  company: "company",
  status: "status",
  "lead source": "source",
  "lead id": "sf_id",
  phone: "phone",
  title: "title",
  industry: "industry",
  website: "website",
  employees: "employees",
  "annual revenue": "annual_revenue",
  street: "street",
  city: "city",
  state: "state",
  "zip/postal code": "zip",
  zip: "zip",
  country: "country",
};

function getFieldMap(entity: EntityType): Record<string, string> {
  switch (entity) {
    case "accounts":
      return ACCOUNT_FIELDS;
    case "contacts":
      return CONTACT_FIELDS;
    case "opportunities":
      return OPPORTUNITY_FIELDS;
    case "leads":
      return LEAD_FIELDS;
  }
}

/** All possible CRM target fields for a given entity. */
function getCRMFields(entity: EntityType): string[] {
  switch (entity) {
    case "accounts":
      return [
        "name",
        "sf_id",
        "industry",
        "website",
        "notes",
        "billing_street",
        "billing_city",
        "billing_state",
        "billing_zip",
        "billing_country",
        "owner_user_id",
        "account_type",
        "annual_revenue",
        "employees",
        "lifecycle_status",
        "status",
        "timezone",
        "fte_count",
        "fte_range",
        "locations",
      ];
    case "contacts":
      return [
        "first_name",
        "last_name",
        "email",
        "title",
        "phone",
        "sf_id",
        "account_id_sf_lookup",
        "is_primary",
        "department",
        "linkedin_url",
      ];
    case "opportunities":
      return [
        "name",
        "sf_id",
        "account_id_sf_lookup",
        "stage",
        "amount",
        "close_date",
        "kind",
        "expected_close_date",
        "notes",
        "probability",
        "description",
      ];
    case "leads":
      return [
        "first_name",
        "last_name",
        "email",
        "company",
        "status",
        "source",
        "sf_id",
        "phone",
        "title",
        "industry",
        "website",
        "employees",
        "annual_revenue",
        "street",
        "city",
        "state",
        "zip",
        "country",
        "description",
      ];
  }
}

/** Human-readable label for a CRM field key. */
function fieldLabel(key: string): string {
  return key
    .replace(/_sf_lookup$/, " (SF Lookup)")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================
   Component
   ================================================================ */

export function SalesforceImport() {
  const [entity, setEntity] = useState<EntityType>("accounts");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update">(
    "skip"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---------- File handling ---------- */

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setResult(null);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) {
          toast.error("CSV must have a header row and at least one data row.");
          return;
        }

        const headers = parsed[0];
        const dataRows = parsed.slice(1);
        setCsvHeaders(headers);
        setCsvRows(dataRows);

        // Auto-map columns
        const fieldMap = getFieldMap(entity);
        const autoMappings: ColumnMapping[] = headers.map((h) => {
          const normalized = h.toLowerCase().trim();
          const match = fieldMap[normalized];
          return { csvColumn: h, crmField: match ?? "" };
        });
        setMappings(autoMappings);
        toast.success(`Loaded ${dataRows.length} rows from ${file.name}`);
      };
      reader.readAsText(file);
    },
    [entity]
  );

  const updateMapping = useCallback(
    (csvColumn: string, crmField: string) => {
      setMappings((prev) =>
        prev.map((m) => (m.csvColumn === csvColumn ? { ...m, crmField } : m))
      );
    },
    []
  );

  /* ---------- Build mapped data for preview ---------- */

  function buildMappedRow(
    rowValues: string[],
    headers: string[],
    columnMappings: ColumnMapping[]
  ): Record<string, string> {
    const mapped: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const mapping = columnMappings.find((m) => m.csvColumn === header);
      if (mapping?.crmField) {
        mapped[mapping.crmField] = rowValues[idx] ?? "";
      }
    });
    return mapped;
  }

  const previewRows = csvRows.slice(0, 5).map((row) =>
    buildMappedRow(row, csvHeaders, mappings)
  );

  const activeMappings = mappings.filter((m) => m.crmField !== "");

  /* ---------- Import ---------- */

  async function handleImport() {
    if (activeMappings.length === 0) {
      toast.error("Map at least one column before importing.");
      return;
    }

    setImporting(true);
    setResult(null);

    const imported: number[] = [0];
    const skipped: number[] = [0];
    const errors: string[] = [];

    try {
      // Pre-fetch lookup data
      const { data: users } = await supabase
        .from("user_profiles")
        .select("id, full_name");

      let accountSfMap: Map<string, string> | null = null;
      if (
        entity === "contacts" ||
        entity === "opportunities"
      ) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, sf_id")
          .not("sf_id", "is", null);
        accountSfMap = new Map(
          (accounts ?? []).map((a) => [a.sf_id as string, a.id as string])
        );
      }

      const tableName = entity;
      const batchSize = 50;
      const total = csvRows.length;
      setProgress({ current: 0, total });

      for (let i = 0; i < total; i += batchSize) {
        const batch = csvRows.slice(i, i + batchSize);
        const records: Record<string, unknown>[] = [];

        for (let j = 0; j < batch.length; j++) {
          const rowIndex = i + j;
          const row = batch[j];
          const mapped = buildMappedRow(row, csvHeaders, mappings);

          const record: Record<string, unknown> = {};
          let skipRow = false;

          for (const [field, value] of Object.entries(mapped)) {
            if (!value && value !== "0") continue;

            if (field === "owner_user_id") {
              // Lookup user by name
              const user = users?.find(
                (u) =>
                  u.full_name?.toLowerCase() === value.toLowerCase()
              );
              if (user) {
                record.owner_user_id = user.id;
              }
              continue;
            }

            if (field === "account_id_sf_lookup") {
              // Lookup account by SF ID
              if (accountSfMap) {
                const accountId = accountSfMap.get(value);
                if (accountId) {
                  record.account_id = accountId;
                } else {
                  errors.push(
                    `Row ${rowIndex + 1}: Account SF ID "${value}" not found in CRM`
                  );
                  skipRow = true;
                }
              }
              continue;
            }

            // Numeric fields
            if (
              [
                "annual_revenue",
                "employees",
                "amount",
                "probability",
                "fte_count",
                "locations",
              ].includes(field)
            ) {
              const num = Number(value.replace(/[,$]/g, ""));
              if (!isNaN(num)) {
                record[field] = num;
              }
              continue;
            }

            // Boolean fields
            if (field === "is_primary") {
              record[field] = value.toLowerCase() === "true" || value === "1";
              continue;
            }

            record[field] = value;
          }

          if (skipRow) {
            skipped[0]++;
            continue;
          }

          // Check for required fields
          if (entity === "accounts" && !record.name) {
            errors.push(`Row ${rowIndex + 1}: Missing account name`);
            skipped[0]++;
            continue;
          }
          if (entity === "contacts" && (!record.first_name || !record.last_name)) {
            errors.push(
              `Row ${rowIndex + 1}: Missing first or last name`
            );
            skipped[0]++;
            continue;
          }
          if (entity === "contacts" && !record.account_id) {
            errors.push(
              `Row ${rowIndex + 1}: Missing account reference`
            );
            skipped[0]++;
            continue;
          }
          if (entity === "opportunities" && (!record.name || !record.account_id)) {
            errors.push(
              `Row ${rowIndex + 1}: Missing name or account reference`
            );
            skipped[0]++;
            continue;
          }
          if (entity === "leads" && (!record.first_name || !record.last_name)) {
            errors.push(
              `Row ${rowIndex + 1}: Missing first or last name`
            );
            skipped[0]++;
            continue;
          }

          // Defaults
          if (entity === "accounts") {
            record.lifecycle_status = record.lifecycle_status ?? "prospect";
            record.status = record.status ?? "discovery";
          }
          if (entity === "opportunities") {
            record.stage = record.stage ?? "lead";
            record.amount = record.amount ?? 0;
            record.team = record.team ?? "sales";
            record.kind = record.kind ?? "new_business";
          }
          if (entity === "leads") {
            record.status = record.status ?? "new";
          }

          records.push(record);
        }

        if (records.length === 0) {
          setProgress({ current: Math.min(i + batchSize, total), total });
          continue;
        }

        // Check for duplicates by sf_id
        const sfIds = records
          .map((r) => r.sf_id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        let existingSfIds = new Set<string>();
        if (sfIds.length > 0) {
          const { data: existing } = await supabase
            .from(tableName)
            .select("id, sf_id")
            .in("sf_id", sfIds);
          existingSfIds = new Set(
            (existing ?? []).map((e) => e.sf_id as string)
          );
        }

        const toInsert: Record<string, unknown>[] = [];
        const toUpdate: { id: string; data: Record<string, unknown> }[] = [];

        for (const record of records) {
          const sfId = record.sf_id as string | undefined;
          if (sfId && existingSfIds.has(sfId)) {
            if (duplicateAction === "skip") {
              skipped[0]++;
            } else {
              // Find existing record id
              const { data: existing } = await supabase
                .from(tableName)
                .select("id")
                .eq("sf_id", sfId)
                .limit(1)
                .single();
              if (existing) {
                const { sf_id: _removed, ...updateData } = record;
                toUpdate.push({ id: existing.id, data: updateData });
              }
            }
          } else {
            toInsert.push(record);
          }
        }

        // Insert new records
        if (toInsert.length > 0) {
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(toInsert);
          if (insertError) {
            errors.push(
              `Batch at row ${i + 1}: ${insertError.message}`
            );
          } else {
            imported[0] += toInsert.length;
          }
        }

        // Update existing records
        for (const { id: recordId, data } of toUpdate) {
          const { error: updateError } = await supabase
            .from(tableName)
            .update(data)
            .eq("id", recordId);
          if (updateError) {
            errors.push(
              `Update sf_id ${data.sf_id ?? recordId}: ${updateError.message}`
            );
          } else {
            imported[0]++;
          }
        }

        setProgress({ current: Math.min(i + batchSize, total), total });
      }
    } catch (err) {
      errors.push(`Unexpected error: ${(err as Error).message}`);
    }

    setImporting(false);
    setResult({ imported: imported[0], skipped: skipped[0], errors });

    if (errors.length === 0) {
      toast.success(
        `Import complete: ${imported[0]} records imported, ${skipped[0]} skipped.`
      );
    } else {
      toast.warning(
        `Import finished with ${errors.length} error(s). See details below.`
      );
    }
  }

  /* ---------- Reset ---------- */

  function handleReset() {
    setCsvHeaders([]);
    setCsvRows([]);
    setMappings([]);
    setResult(null);
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /* ---------- Render ---------- */

  const crmFields = getCRMFields(entity);
  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            How to Import from Salesforce
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>
              Export your data from Salesforce using Data Loader or Reports (CSV
              format).
            </li>
            <li>Select the entity type you want to import below.</li>
            <li>Upload your CSV file.</li>
            <li>
              Review the column mapping -- common Salesforce field names are
              auto-detected.
            </li>
            <li>Preview your data and click Import.</li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 1: Entity Type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Step 1: Select Entity Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="entity-type">Entity</Label>
            <Select
              value={entity}
              onValueChange={(v) => {
                setEntity(v as EntityType);
                handleReset();
              }}
            >
              <SelectTrigger id="entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounts">Accounts</SelectItem>
                <SelectItem value="contacts">Contacts</SelectItem>
                <SelectItem value="opportunities">Opportunities</SelectItem>
                <SelectItem value="leads">Leads</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Upload CSV */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 2: Upload CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="max-w-sm"
            />
            {csvRows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                {csvRows.length} rows, {csvHeaders.length} columns
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Column Mapping */}
      {csvHeaders.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 3: Column Mapping
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>CRM Field</TableHead>
                    <TableHead>Sample Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m, idx) => (
                    <TableRow key={m.csvColumn}>
                      <TableCell className="font-medium">
                        {m.csvColumn}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.crmField || "skip"}
                          onValueChange={(v) =>
                            updateMapping(
                              m.csvColumn,
                              v === "skip" ? "" : v
                            )
                          }
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">
                              -- Skip --
                            </SelectItem>
                            {crmFields.map((f) => (
                              <SelectItem key={f} value={f}>
                                {fieldLabel(f)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {csvRows[0]?.[idx] ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Preview */}
      {previewRows.length > 0 && activeMappings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 4: Preview (first {previewRows.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {activeMappings.map((m) => (
                      <TableHead key={m.crmField}>
                        {fieldLabel(m.crmField)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow key={idx}>
                      {activeMappings.map((m) => (
                        <TableCell
                          key={m.crmField}
                          className="truncate max-w-[200px]"
                        >
                          {row[m.crmField] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Import */}
      {csvRows.length > 0 && activeMappings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Step 5: Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <Label>Duplicate Handling (by SF ID)</Label>
                <Select
                  value={duplicateAction}
                  onValueChange={(v) =>
                    setDuplicateAction(v as "skip" | "update")
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip Duplicates</SelectItem>
                    <SelectItem value="update">
                      Update Existing
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-5">
                <Button
                  onClick={handleImport}
                  disabled={importing}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {importing
                    ? `Importing... (${progress.current} of ${progress.total})`
                    : `Import ${csvRows.length} rows`}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={importing}
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            {importing && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Importing row {progress.current} of {progress.total}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {result.imported} imported
                  </span>
                  {result.skipped > 0 && (
                    <span className="inline-flex items-center gap-1 text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      {result.skipped} skipped
                    </span>
                  )}
                  {result.errors.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      {result.errors.length} error(s)
                    </span>
                  )}
                </div>

                {result.errors.length > 0 && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3 max-h-48 overflow-y-auto">
                    <p className="text-sm font-medium text-destructive mb-1">
                      Errors:
                    </p>
                    <ul className="text-xs text-destructive space-y-0.5">
                      {result.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
