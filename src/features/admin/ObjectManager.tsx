import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Database, Link2, ListChecks, Hash } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

/**
 * Object Manager — Salesforce-style schema browser.
 * Lists every entity (table) and every field on each, with type, FK
 * target, picklist option count, and example REST API path. Read-only.
 *
 * For ADDING new fields, see Admin → Custom Fields.
 * For MANAGING picklist values, see Admin → Picklists.
 */

interface FieldRow {
  entity: string;
  field: string;
  data_type: string;
  udt_name: string;
  field_type_friendly: string;
  is_nullable: boolean;
  default_value: string | null;
  references_table: string | null;
  references_field: string | null;
  picklist_options: number | null;
  ordinal_position: number;
}

const ENTITY_LABELS: Record<string, string> = {
  accounts: "Account",
  contacts: "Contact",
  leads: "Lead",
  opportunities: "Opportunity",
  opportunity_products: "Opportunity Product",
  products: "Product",
  price_books: "Price Book",
  price_book_entries: "Price Book Entry",
  activities: "Activity",
  partners: "Partner",
  account_partners: "Account Partner",
  tasks: "Task",
};

export function ObjectManager() {
  const { data, isLoading } = useQuery({
    queryKey: ["object-manager-fields"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_field_inventory")
        .select("*");
      if (error) throw error;
      return (data ?? []) as FieldRow[];
    },
  });

  const [activeEntity, setActiveEntity] = useState<string>("accounts");
  const [search, setSearch] = useState("");

  const byEntity = useMemo(() => {
    const map = new Map<string, FieldRow[]>();
    for (const row of data ?? []) {
      const list = map.get(row.entity) ?? [];
      list.push(row);
      map.set(row.entity, list);
    }
    return map;
  }, [data]);

  const allEntities = useMemo(
    () => Array.from(byEntity.keys()).sort(),
    [byEntity],
  );

  const filteredFields = useMemo(() => {
    const fields = byEntity.get(activeEntity) ?? [];
    if (!search) return fields;
    const q = search.toLowerCase();
    return fields.filter(
      (f) =>
        f.field.toLowerCase().includes(q) ||
        f.field_type_friendly.toLowerCase().includes(q) ||
        f.references_table?.toLowerCase().includes(q),
    );
  }, [byEntity, activeEntity, search]);

  const supabaseRefHint = "https://<your-supabase-ref>.supabase.co";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Object Manager
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Browse every entity and field in the CRM. Read-only inventory of
          schema, foreign-key relationships, picklist-backed columns, and REST
          API endpoints. Add new fields via{" "}
          <strong>Custom Fields</strong>; manage dropdown values via{" "}
          <strong>Picklists</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-4">
            <Label htmlFor="om-entity">Entity</Label>
            <Select value={activeEntity} onValueChange={setActiveEntity}>
              <SelectTrigger id="om-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allEntities.map((e) => (
                  <SelectItem key={e} value={e}>
                    {ENTITY_LABELS[e] ?? e} ({byEntity.get(e)?.length ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-8">
            <Label htmlFor="om-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="om-search"
                className="pl-8"
                placeholder="Filter fields by name, type, or reference"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              <strong>Table name:</strong>{" "}
              <code className="bg-muted px-1 py-0.5 rounded">{activeEntity}</code>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              <strong>REST endpoint:</strong>{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                {supabaseRefHint}/rest/v1/{activeEntity}?select=*
              </code>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              <strong>Field count:</strong>{" "}
              {byEntity.get(activeEntity)?.length ?? 0}
            </span>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Nullable</TableHead>
                  <TableHead>References</TableHead>
                  <TableHead>Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFields.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                      No fields match.
                    </TableCell>
                  </TableRow>
                )}
                {filteredFields.map((f) => (
                  <TableRow key={f.field}>
                    <TableCell className="font-mono text-xs">{f.field}</TableCell>
                    <TableCell>
                      <span className="text-xs">{f.field_type_friendly}</span>
                    </TableCell>
                    <TableCell>
                      {f.is_nullable ? (
                        <span className="text-xs text-muted-foreground">yes</span>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">required</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {f.references_table ? (
                        <button
                          type="button"
                          className="text-xs font-mono text-primary hover:underline"
                          onClick={() => setActiveEntity(f.references_table as string)}
                        >
                          {f.references_table}.{f.references_field}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground truncate max-w-xs">
                      {f.default_value ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
