import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldType } from "@/types/crm";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  textarea: "Text Area",
  number: "Number",
  currency: "Currency",
  date: "Date",
  checkbox: "Checkbox",
  select: "Dropdown",
  multi_select: "Multi-Select",
  url: "URL",
  email: "Email",
  phone: "Phone",
};

const ALL_FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[];

interface AddFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: CustomFieldDefinition["entity"];
  existingField?: CustomFieldDefinition | null;
  onSave: (
    values: Omit<CustomFieldDefinition, "id" | "created_at" | "updated_at">
  ) => void;
  saving?: boolean;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function AddFieldDialog({
  open,
  onOpenChange,
  entity,
  existingField,
  onSave,
  saving,
}: AddFieldDialogProps) {
  const [label, setLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [isRequired, setIsRequired] = useState(false);
  const [section, setSection] = useState("Custom Fields");
  const [defaultValue, setDefaultValue] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState("");
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);

  const isEditing = !!existingField;
  const showOptions = fieldType === "select" || fieldType === "multi_select";

  useEffect(() => {
    if (open) {
      if (existingField) {
        setLabel(existingField.label);
        setFieldKey(existingField.field_key);
        setFieldType(existingField.field_type);
        setIsRequired(existingField.is_required);
        setSection(existingField.section);
        setDefaultValue(existingField.default_value ?? "");
        setSortOrder(existingField.sort_order);
        setOptions(existingField.options ?? []);
        setKeyManuallyEdited(true);
      } else {
        setLabel("");
        setFieldKey("");
        setFieldType("text");
        setIsRequired(false);
        setSection("Custom Fields");
        setDefaultValue("");
        setSortOrder(0);
        setOptions([]);
        setNewOption("");
        setKeyManuallyEdited(false);
      }
    }
  }, [open, existingField]);

  function handleLabelChange(value: string) {
    setLabel(value);
    if (!keyManuallyEdited) {
      setFieldKey(slugify(value));
    }
  }

  function handleAddOption() {
    const trimmed = newOption.trim();
    if (trimmed && !options.includes(trimmed)) {
      setOptions([...options, trimmed]);
      setNewOption("");
    }
  }

  function handleRemoveOption(opt: string) {
    setOptions(options.filter((o) => o !== opt));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !fieldKey.trim()) return;

    onSave({
      entity,
      field_key: fieldKey,
      label: label.trim(),
      field_type: fieldType,
      is_required: isRequired,
      options: showOptions ? options : null,
      default_value: defaultValue.trim() || null,
      sort_order: sortOrder,
      section: section.trim() || "Custom Fields",
      is_active: existingField?.is_active ?? true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Custom Field" : "Add Custom Field"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="field-label">Label *</Label>
            <Input
              id="field-label"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. Company Size"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-key">Field Key</Label>
            <Input
              id="field-key"
              value={fieldKey}
              onChange={(e) => {
                setFieldKey(e.target.value);
                setKeyManuallyEdited(true);
              }}
              placeholder="auto-generated from label"
              disabled={isEditing}
            />
            <p className="text-xs text-muted-foreground">
              Auto-generated from label. Used as the storage key.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-type">Field Type *</Label>
            <Select
              value={fieldType}
              onValueChange={(val) => setFieldType(val as CustomFieldType)}
              disabled={isEditing}
            >
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="field-required"
              checked={isRequired}
              onCheckedChange={(checked) => setIsRequired(checked === true)}
            />
            <Label htmlFor="field-required" className="cursor-pointer">
              Required
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-section">Section</Label>
            <Input
              id="field-section"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Custom Fields"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-default">Default Value</Label>
            <Input
              id="field-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-sort">Sort Order</Label>
            <Input
              id="field-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
            />
          </div>

          {showOptions && (
            <div className="space-y-2">
              <Label>Options</Label>
              <div className="flex gap-2">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="Add an option..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={handleAddOption}>
                  Add
                </Button>
              </div>
              {options.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {options.map((opt) => (
                    <span
                      key={opt}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-sm"
                    >
                      {opt}
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(opt)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {options.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add at least one option for dropdown fields.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !label.trim() || !fieldKey.trim()}>
              {saving ? "Saving..." : isEditing ? "Update Field" : "Add Field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
