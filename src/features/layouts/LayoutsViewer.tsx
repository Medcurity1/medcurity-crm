import { useMemo, useState } from "react";
import { Layout as LayoutIcon, EyeOff, ShieldCheck, Lock } from "lucide-react";
import { usePageLayout } from "./api";
import type { LayoutEntity } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * Read-only viewer for the page layouts seeded into the database.
 * Phase 1d of the layout-editor build — confirms seeds match the
 * current detail/form pages before we swap rendering over.
 *
 * The drag-and-drop editor (Phase 4) will replace this with an
 * editable view, but the viewer stays useful as a quick reference.
 */
export function LayoutsViewer() {
  const [entity, setEntity] = useState<LayoutEntity>("accounts");
  const { data: layout, isLoading } = usePageLayout(entity);

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
          Sections + field placements that drive both the Detail and Form pages
          for each record type. Read-only preview for now — the drag-and-drop
          editor lands shortly.
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
                <div className="p-3">
                  {section.fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No fields placed.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {section.fields.map((f) => (
                        <div
                          key={f.id}
                          className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border ${
                            f.width === "full" ? "col-span-2" : ""
                          }`}
                        >
                          <span className="font-mono">
                            {f.label_override ?? f.field_key}
                          </span>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[9px]">
                              {f.width}
                            </Badge>
                            {f.read_only_on_form && (
                              <Badge variant="outline" className="text-[9px] gap-0.5">
                                <EyeOff className="h-2.5 w-2.5" />
                                read-only
                              </Badge>
                            )}
                            {f.hide_on_form && (
                              <Badge variant="outline" className="text-[9px]">
                                hidden on form
                              </Badge>
                            )}
                            {f.hide_on_detail && (
                              <Badge variant="outline" className="text-[9px]">
                                hidden on detail
                              </Badge>
                            )}
                            {f.admin_only_on_form && (
                              <Badge variant="outline" className="text-[9px] gap-0.5">
                                <ShieldCheck className="h-2.5 w-2.5" />
                                admin only
                              </Badge>
                            )}
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
