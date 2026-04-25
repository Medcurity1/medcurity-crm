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
 * field_key. Drop-in replacement for hand-rolled <Select>s on every form
 * field that has admin-editable values.
 *
 * Stored values can be strings or numbers — we coerce both to string for
 * the select. The DB column type stays whatever it is.
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
        {options.map((o) => (
          <SelectItem key={o.id} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
