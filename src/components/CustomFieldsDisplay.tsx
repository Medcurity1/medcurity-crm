import type { CustomFieldDefinition } from "@/types/crm";
import { formatCurrency, formatDate } from "@/lib/formatters";

interface CustomFieldsDisplayProps {
  customFields: Record<string, unknown>;
  definitions: CustomFieldDefinition[];
}

function formatFieldValue(value: unknown, fieldType: CustomFieldDefinition["field_type"]): string {
  if (value === null || value === undefined || value === "") return "\u2014";

  switch (fieldType) {
    case "currency":
      return formatCurrency(Number(value));
    case "date":
      return formatDate(String(value));
    case "checkbox":
      return value ? "\u2713" : "\u2717";
    case "number":
      return Number(value).toLocaleString();
    case "multi_select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "url":
      return String(value);
    default:
      return String(value);
  }
}

export function CustomFieldsDisplay({ customFields, definitions }: CustomFieldsDisplayProps) {
  if (!definitions.length) return null;

  const fieldsWithValues = definitions.filter(
    (def) => customFields[def.field_key] !== null && customFields[def.field_key] !== undefined
  );

  if (!fieldsWithValues.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
      {fieldsWithValues.map((def) => {
        const value = customFields[def.field_key];
        const formatted = formatFieldValue(value, def.field_type);

        return (
          <div key={def.id} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{def.label}</span>
            {def.field_type === "url" && value ? (
              <a
                href={String(value)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline truncate"
              >
                {formatted}
              </a>
            ) : def.field_type === "email" && value ? (
              <a
                href={`mailto:${String(value)}`}
                className="text-sm text-primary hover:underline"
              >
                {formatted}
              </a>
            ) : (
              <span className="text-sm font-medium">{formatted}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
