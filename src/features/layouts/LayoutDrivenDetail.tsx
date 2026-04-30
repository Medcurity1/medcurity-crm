import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineEdit, type InlineEditProps } from "@/components/InlineEdit";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { usePageLayout } from "./api";
import type { LayoutEntity, PageLayoutField } from "./types";
import {
  FkLink,
  PicklistAwareDisplay,
  humanizeFieldKey,
} from "./widgets/displayWidgets";

/**
 * Render a record's Detail-page sections + fields driven by the
 * `page_layouts` config. Sections that have `form_only = true` are
 * skipped. Fields with `hide_on_detail = true` are skipped.
 *
 * Custom blocks (field keys starting with `__`) are dispatched to a
 * caller-provided render map. This lets entity-specific widgets like
 * the address block, opportunity products picker, or contracts table
 * coexist with the auto-rendered fields.
 *
 * Inline editing is intentionally NOT in this round — the goal is
 * pixel-parity with current Detail pages first. EditableField wrappers
 * can be added once the layout swap is verified.
 */
export interface LayoutDrivenDetailProps<T extends Record<string, unknown>> {
  entity: LayoutEntity;
  record: T;
  /** Custom block renderers, keyed by `__block_name`. */
  customBlocks?: Record<string, (record: T) => React.ReactNode>;
  /**
   * If provided, fields not in `inlineEditExcluded` and not marked
   * read-only become click-to-edit. The callback receives the field
   * key and the new string value, just like AccountDetail's saveField.
   */
  onInlineSave?: (fieldKey: string, newValue: string) => Promise<void>;
  /** Field keys to render read-only even when onInlineSave is provided. */
  inlineEditExcluded?: string[];
  /** Per-field input type override for inline editing. */
  inlineEditTypes?: Record<string, InlineEditProps["type"]>;
  layoutName?: string;
}

export function LayoutDrivenDetail<T extends Record<string, unknown>>({
  entity,
  record,
  customBlocks,
  onInlineSave,
  inlineEditExcluded,
  inlineEditTypes,
  layoutName = "standard",
}: LayoutDrivenDetailProps<T>) {
  const { data: layout, isLoading } = usePageLayout(entity, layoutName);

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (!layout) {
    return (
      <div className="text-sm text-muted-foreground border rounded-md p-6">
        No layout configured for this entity.
      </div>
    );
  }

  return (
    <div>
      {layout.sections
        .filter((s) => !s.form_only)
        .map((section) => {
          const fields = section.fields.filter((f) => !f.hide_on_detail);
          if (fields.length === 0) return null;

          return (
            <CollapsibleSection
              key={section.id}
              title={section.title}
              defaultOpen={!section.collapsed_by_default}
            >
              <div className="grid grid-cols-2 gap-4">
                {fields.map((field) => (
                  <FieldCell
                    key={field.id}
                    field={field}
                    entity={entity}
                    record={record}
                    customBlocks={customBlocks}
                    onInlineSave={onInlineSave}
                    inlineEditExcluded={inlineEditExcluded}
                    inlineEditTypes={inlineEditTypes}
                  />
                ))}
              </div>
            </CollapsibleSection>
          );
        })}
    </div>
  );
}

function FieldCell<T extends Record<string, unknown>>({
  field,
  entity,
  record,
  customBlocks,
  onInlineSave,
  inlineEditExcluded,
  inlineEditTypes,
}: {
  field: PageLayoutField;
  entity: string;
  record: T;
  customBlocks?: Record<string, (record: T) => React.ReactNode>;
  onInlineSave?: (fieldKey: string, newValue: string) => Promise<void>;
  inlineEditExcluded?: string[];
  inlineEditTypes?: Record<string, InlineEditProps["type"]>;
}) {
  const colSpan = field.width === "full" ? "col-span-2" : "";
  const label = field.label_override ?? humanizeFieldKey(field.field_key);

  // Custom block dispatch
  if (field.field_key.startsWith("__")) {
    const renderer = customBlocks?.[field.field_key];
    return (
      <div className={cn(colSpan, "flex flex-col")}>
        {renderer ? (
          renderer(record)
        ) : (
          <div className="text-xs text-muted-foreground italic border border-dashed rounded p-2">
            Unrendered custom block: <code>{field.field_key}</code>
          </div>
        )}
      </div>
    );
  }

  const value = record[field.field_key];

  // Inline-editable path: only when caller opts in, the field isn't excluded,
  // it isn't an FK with embed (those use links), and it's not a picklist
  // (picklists need their own editor — out of scope this round).
  const inlineEditable =
    onInlineSave &&
    !inlineEditExcluded?.includes(field.field_key) &&
    !field.field_key.endsWith("_id") &&
    !field.field_key.startsWith("sf_");

  if (inlineEditable) {
    const inputType = inlineEditTypes?.[field.field_key] ?? "text";
    return (
      <div className={cn(colSpan, "flex flex-col")}>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          {label}
          <HelpTooltip text={field.help_text} />
        </span>
        <InlineEdit
          value={value as string | number | null}
          onSave={(v) => onInlineSave!(field.field_key, v)}
          type={inputType}
        />
      </div>
    );
  }

  // Read-only path
  // FK link (account, contact, etc.) takes priority — uses embed if present
  const fkLink = FkLink({ fieldKey: field.field_key, record });

  return (
    <div className={cn(colSpan, "flex flex-col")}>
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        <HelpTooltip text={field.help_text} />
      </span>
      {fkLink ?? (
        <PicklistAwareDisplay
          fieldKey={field.field_key}
          entity={entity}
          value={value}
          record={record as Record<string, unknown>}
        />
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        {title}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// Re-export helpers for callers that want to use them outside this component
export { DisplayValue, PicklistAwareDisplay, humanizeFieldKey } from "./widgets/displayWidgets";
