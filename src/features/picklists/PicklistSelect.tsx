import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePicklistOptionsFor } from "./api";

interface PicklistSelectProps {
  /** field_key, e.g. 'opportunities.contract_length_months' */
  fieldKey: string;
  /** Current stored value (string or number — coerced to string for the select) */
  value: string | number | null | undefined;
  /** Called with the picked value, OR null when "Clear" / no selection. */
  onChange: (value: string | null) => void;
  /** HTML id for the select trigger (lets <Label htmlFor=...> work) */
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Show a "Clear" sentinel option so the user can unset the value. */
  allowClear?: boolean;
  className?: string;
}

/**
 * Renders a <Select> backed by the picklist_options table for the given
 * field_key.
 *
 * Legacy-value handling: if the record's stored value isn't in the
 * current picklist (e.g. an SF-imported value like "Hospital & Health
 * Care" that was deduped out of the canonical list), we still display
 * it in the dropdown labeled "(legacy)" so:
 *   1. The user sees what's currently saved (no blank field surprise)
 *   2. They can intentionally pick a canonical value to migrate
 *   3. Saving without changing keeps the legacy value untouched
 *
 * The legacy entry only appears for THIS record's value — it doesn't
 * pollute the picklist for other records.
 */
export function PicklistSelect({
  fieldKey,
  value,
  onChange,
  id,
  placeholder = "Select…",
  disabled,
  allowClear,
  className,
}: PicklistSelectProps) {
  const { options, isLoading } = usePicklistOptionsFor(fieldKey);
  const stringValue =
    value === null || value === undefined || value === "" ? "__none__" : String(value);

  // Detect a legacy value: stored on the record but not in the picklist.
  const isLegacy =
    stringValue !== "__none__" && !options.some((o) => o.value === stringValue);

  return (
    <Select
      value={stringValue}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && (
          <SelectItem value="__none__">— None —</SelectItem>
        )}
        {isLegacy && (
          <SelectItem value={stringValue}>
            {stringValue} <span className="text-xs text-muted-foreground">(legacy)</span>
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
