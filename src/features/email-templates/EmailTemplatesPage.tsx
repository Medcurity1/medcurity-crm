import { useMemo, useState } from "react";
import { Mail, Plus, Users, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useEmailTemplates,
  useDeleteEmailTemplate,
} from "./templates-api";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import type { EmailTemplate } from "@/types/crm";

export function EmailTemplatesPage() {
  const { data: templates, isLoading } = useEmailTemplates();
  const deleteMutation = useDeleteEmailTemplate();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates ?? []) {
      if (t.category) set.add(t.category);
    }
    return Array.from(set).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates ?? []).filter((t) => {
      if (categoryFilter !== "__all__") {
        if ((t.category ?? "") !== categoryFilter) return false;
      }
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q)
      );
    });
  }, [templates, search, categoryFilter]);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(template: EmailTemplate) {
    setEditing(template);
    setEditorOpen(true);
  }

  async function handleDelete(e: React.MouseEvent, template: EmailTemplate) {
    e.stopPropagation();
    if (!confirm(`Delete template "${template.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(template.id);
      toast.success("Template deleted");
    } catch (err) {
      toast.error("Failed to delete: " + (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Email Templates"
        description="Reusable templates for manual outreach and sequences."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or subject..."
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : !filtered.length ? (
        <EmptyState
          icon={Mail}
          title={
            templates?.length
              ? "No templates match your filters"
              : "No email templates yet"
          }
          description={
            templates?.length
              ? "Try a different search or category."
              : "Create reusable email templates to speed up outreach."
          }
          action={
            templates?.length
              ? undefined
              : { label: "New Template", onClick: openNew }
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => openEdit(t)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-sm truncate">
                      {t.name}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {t.subject}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(e, t)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {t.category && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t.category}
                    </Badge>
                  )}
                  {t.is_shared && (
                    <Badge
                      variant="outline"
                      className="text-[10px] flex items-center gap-1"
                    >
                      <Users className="h-3 w-3" />
                      Shared
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    Used {t.usage_count}x
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editing}
      />
    </div>
  );
}
