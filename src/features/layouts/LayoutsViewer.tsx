import { useMemo, useState } from "react";
import {
  Layout as LayoutIcon,
  ShieldCheck,
  Lock,
  Columns2,
  Square,
  Columns3,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePageLayout, useUpdatePageLayoutField } from "./api";
import type { LayoutEntity } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ENTITY_OPTIONS: { value: LayoutEntity; label: string }[] = [
  { value: "accounts", label: "Account" },
  { value: "contacts", label: "Contact" },
  { value: "leads", label: "Lead" },
  { value: "opportunities", label: "Opportunity" },
  { value: "activities", label: "Activity" },
  { value: "products", label: "Product" },
  { value: "account_partners", label: "Partner Relationship" },
];

/**
 * Page layouts viewer. Phase 1d shipped this as read-only; this
 * version adds inline toggles for hide_on_form / hide_on_detail per
 * field so admins can hide a field from a page WITHOUT losing data
 * or waiting for the full drag-and-drop editor (Phase 4).
 *
 * Width is now shown with both an icon AND a hover tooltip so the
 * meaning of "half / full / third" is obvious.
 */
export function LayoutsViewer() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [entity, setEntity] = useState<LayoutEntity>("accounts");
  const { data: layout, isLoading } = usePageLayout(entity);
  const updateField = useUpdatePageLayoutField();

  const summary = useMemo(() => {
    if (!layout) return null;
    const sectionCount = layout.sections.length;
    const fieldCount = layout.sections.reduce((n, s) => n + s.fields.length, 0);
    const detailOnly = layout.sections.filter((s) => s.detail_only).length;
    const formOnly = layout.sections.filter((s) => s.form_only).length;
    return { sectionCount, fieldCount, detailOnly, formOnly };
  }, [layout]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutIcon className="h-5 w-5" />
          Page Layouts
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Sections and fields shown on each record's Detail and Form pages.
          Toggle <strong>Show on Detail</strong> or <strong>Show on Form</strong> per field
          to hide it from a page without losing the data. Drag-and-drop reorder
          editor is coming next.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-4">
            <Label htmlFor="layout-entity">Entity</Label>
            <Select value={entity} onValueChange={(v) => setEntity(v as LayoutEntity)}>
              <SelectTrigger id="layout-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {summary && (
            <div className="col-span-8 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{summary.sectionCount} sections</Badge>
              <Badge variant="secondary">{summary.fieldCount} fields</Badge>
              {summary.detailOnly > 0 && (
                <Badge variant="outline">{summary.detailOnly} detail-only</Badge>
              )}
              {summary.formOnly > 0 && (
                <Badge variant="outline">{summary.formOnly} form-only</Badge>
              )}
              {layout?.is_locked && (
                <Badge className="gap-1">
                  <Lock className="h-3 w-3" />
                  Locked (super-admin only)
                </Badge>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : !layout ? (
          <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
            No layout seeded for this entity yet.
          </div>
        ) : (
          <div className="space-y-3">
            {layout.sections.map((section) => (
              <div key={section.id} className="border rounded-md">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{section.title}</span>
                    {section.collapsed_by_default && (
                      <Badge variant="outline" className="text-[10px]">
                        Collapsed by default
                      </Badge>
                    )}
                    {section.detail_only && (
                      <Badge variant="outline" className="text-[10px]">
                        Detail only
                      </Badge>
                    )}
                    {section.form_only && (
                      <Badge variant="outline" className="text-[10px]">
                        Form only
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {section.fields.length} field{section.fields.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div>
                  {section.fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic p-3">
                      No fields placed.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {section.fields.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <WidthIcon width={f.width} />
                            <span className="font-mono text-xs truncate">
                              {f.label_override ?? f.field_key}
                            </span>
                            {f.read_only_on_form && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[9px]">
                                    read-only
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Cannot be edited on the Form (auto-calculated or
                                  imported)
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {f.admin_only_on_form && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[9px] gap-0.5">
                                    <ShieldCheck className="h-2.5 w-2.5" />
                                    admin only
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Editable on the Form for admin/super_admin only
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {f.help_text && (
                              <span className="text-[10px] text-muted-foreground italic truncate">
                                {f.help_text}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <FieldVisibilityToggle
                              label="Detail"
                              checked={!f.hide_on_detail}
                              disabled={!isAdmin || section.form_only}
                              onCheckedChange={async (checked) => {
                                try {
                                  await updateField.mutateAsync({
                                    id: f.id,
                                    patch: { hide_on_detail: !checked },
                                  });
                                  toast.success(
                                    `${f.field_key} ${checked ? "shown on" : "hidden from"} Detail`
                                  );
                                } catch (err) {
                                  toast.error(
                                    "Failed: " + (err as Error).message
                                  );
                                }
                              }}
                            />
                            <FieldVisibilityToggle
                              label="Form"
                              checked={!f.hide_on_form}
                              disabled={!isAdmin || section.detail_only}
                              onCheckedChange={async (checked) => {
                                try {
                                  await updateField.mutateAsync({
                                    id: f.id,
                                    patch: { hide_on_form: !checked },
                                  });
                                  toast.success(
                                    `${f.field_key} ${checked ? "shown on" : "hidden from"} Form`
                                  );
                                } catch (err) {
                                  toast.error(
                                    "Failed: " + (err as Error).message
                                  );
                                }
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Visual width indicator. Replaces the prior "half" / "full" / "third"
 * text badge, which wasn't self-explanatory.
 */
function WidthIcon({ width }: { width: "full" | "half" | "third" }) {
  const meta = {
    full: { Icon: Square, label: "Full row (1 field per row)" },
    half: { Icon: Columns2, label: "Half row (2 fields per row)" },
    third: { Icon: Columns3, label: "Third row (3 fields per row)" },
  }[width];
  const { Icon, label } = meta;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FieldVisibilityToggle({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
            className="h-4 w-7"
          />
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {disabled
          ? `Cannot toggle (section is locked to ${label === "Detail" ? "form" : "detail"} only)`
          : `Show this field on the ${label} page`}
      </TooltipContent>
    </Tooltip>
  );
}
