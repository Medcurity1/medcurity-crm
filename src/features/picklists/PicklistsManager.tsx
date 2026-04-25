import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  usePicklistOptions,
  useCreatePicklistOption,
  useUpdatePicklistOption,
  useDeletePicklistOption,
  type PicklistOption,
} from "./api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * Friendly catalog of editable picklists. Each entry maps a stable
 * field_key to a human label + which entity / column it controls.
 * Adding a new admin-editable picklist is one line here PLUS a seed
 * row in the picklist_options migration.
 */
const FIELDS: { key: string; label: string; entity: string; help?: string }[] = [
  {
    key: "opportunities.contract_length_months",
    label: "Contract Length",
    entity: "Opportunity",
    help: "Stored as months. Show 1 Year = 12, 2 Year = 24, 3 Year = 36.",
  },
  {
    key: "opportunities.contract_year",
    label: "Contract Year",
    entity: "Opportunity",
    help: "Year 1 / 2 / 3 within a multi-year contract.",
  },
  {
    key: "opportunities.payment_frequency",
    label: "Payment Frequency",
    entity: "Opportunity",
  },
  {
    key: "opportunities.lead_source",
    label: "Lead Source",
    entity: "Opportunity",
  },
  {
    key: "leads.lead_source",
    label: "Lead Source",
    entity: "Lead",
  },
  {
    key: "accounts.account_type",
    label: "Account Type",
    entity: "Account",
    help: "Direct, Referral, Partner-Alliance, Self-Service, etc.",
  },
  {
    key: "accounts.industry",
    label: "Industry",
    entity: "Account",
  },
  {
    key: "accounts.renewal_type",
    label: "Renewal Type",
    entity: "Account",
  },
];

export function PicklistsManager() {
  const { data: byField, isLoading } = usePicklistOptions();
  const [activeKey, setActiveKey] = useState<string>(FIELDS[0].key);
  const create = useCreatePicklistOption();
  const update = useUpdatePicklistOption();
  const remove = useDeletePicklistOption();

  // Add-row state
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSort, setNewSort] = useState("100");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editSort, setEditSort] = useState("100");

  const activeField = FIELDS.find((f) => f.key === activeKey);
  const options = useMemo(
    () => (byField?.get(activeKey) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [byField, activeKey],
  );

  function startEdit(o: PicklistOption) {
    setEditingId(o.id);
    setEditLabel(o.label);
    setEditSort(String(o.sort_order));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    try {
      await update.mutateAsync({
        id,
        patch: {
          label: editLabel.trim(),
          sort_order: Number(editSort) || 100,
        },
      });
      toast.success("Saved");
      setEditingId(null);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }

  async function toggleActive(o: PicklistOption) {
    try {
      await update.mutateAsync({
        id: o.id,
        patch: { is_active: !o.is_active },
      });
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`);
    }
  }

  async function addOption() {
    if (!newValue.trim() || !newLabel.trim()) {
      toast.error("Value and label required");
      return;
    }
    try {
      await create.mutateAsync({
        field_key: activeKey,
        value: newValue.trim(),
        label: newLabel.trim(),
        sort_order: Number(newSort) || 100,
      });
      setNewValue("");
      setNewLabel("");
      setNewSort("100");
      toast.success("Added");
    } catch (err) {
      toast.error(`Add failed: ${(err as Error).message}`);
    }
  }

  async function deleteOption(o: PicklistOption) {
    if (
      !confirm(
        `Delete "${o.label}"? This won't affect existing records that already use this value.`,
      )
    )
      return;
    try {
      await remove.mutateAsync(o.id);
      toast.success("Deleted");
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Picklists</CardTitle>
        <p className="text-sm text-muted-foreground">
          Admin-editable dropdown values. Adding or hiding values takes effect immediately
          across the whole CRM.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-md">
            <Label htmlFor="picklist-field">Field</Label>
            <Select value={activeKey} onValueChange={setActiveKey}>
              <SelectTrigger id="picklist-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.entity} — {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            <code className="bg-muted px-1 py-0.5 rounded">{activeKey}</code>
          </p>
        </div>

        {activeField?.help && (
          <p className="text-xs text-muted-foreground">{activeField.help}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Stored Value</TableHead>
                  <TableHead>Display Label</TableHead>
                  <TableHead className="w-24">Sort Order</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {options.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                      No options yet — add the first one below.
                    </TableCell>
                  </TableRow>
                )}
                {options.map((o) => (
                  <TableRow key={o.id} className={o.is_active ? "" : "opacity-60"}>
                    <TableCell className="font-mono text-xs">{o.value}</TableCell>
                    <TableCell>
                      {editingId === o.id ? (
                        <Input
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="h-8"
                        />
                      ) : (
                        o.label
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === o.id ? (
                        <Input
                          type="number"
                          value={editSort}
                          onChange={(e) => setEditSort(e.target.value)}
                          className="h-8 w-20"
                        />
                      ) : (
                        o.sort_order
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={o.is_active}
                        onCheckedChange={() => toggleActive(o)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === o.id ? (
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => saveEdit(o.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={cancelEdit}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEdit(o)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteOption(o)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add new option */}
        <Card className="border-dashed">
          <CardContent className="pt-4 grid grid-cols-12 gap-3 items-end">
            <div className="col-span-3">
              <Label htmlFor="new-value">Stored Value</Label>
              <Input
                id="new-value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. 12"
              />
            </div>
            <div className="col-span-5">
              <Label htmlFor="new-label">Display Label</Label>
              <Input
                id="new-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. 1 Year"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="new-sort">Sort Order</Label>
              <Input
                id="new-sort"
                type="number"
                value={newSort}
                onChange={(e) => setNewSort(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Button onClick={addOption} disabled={create.isPending} className="w-full">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}
