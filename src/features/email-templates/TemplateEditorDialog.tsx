import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
} from "./templates-api";
import type { EmailTemplate } from "@/types/crm";

interface TemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: EmailTemplate | null;
}

export function TemplateEditorDialog({
  open,
  onOpenChange,
  template,
}: TemplateEditorDialogProps) {
  const { user } = useAuth();
  const createMutation = useCreateEmailTemplate();
  const updateMutation = useUpdateEmailTemplate();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isShared, setIsShared] = useState(false);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setCategory(template?.category ?? "");
      setSubject(template?.subject ?? "");
      setBody(template?.body ?? "");
      setIsShared(template?.is_shared ?? false);
    }
  }, [open, template]);

  async function handleSave() {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      toast.error("Name, subject, and body are required");
      return;
    }
    try {
      if (template) {
        await updateMutation.mutateAsync({
          id: template.id,
          name: name.trim(),
          subject: subject.trim(),
          body,
          category: category.trim() || null,
          is_shared: isShared,
        });
        toast.success("Template updated");
      } else {
        if (!user?.id) {
          toast.error("You must be signed in to create templates");
          return;
        }
        await createMutation.mutateAsync({
          name: name.trim(),
          subject: subject.trim(),
          body,
          category: category.trim() || null,
          is_shared: isShared,
          owner_user_id: user.id,
        });
        toast.success("Template created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save template: " + (err as Error).message);
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Template" : "New Email Template"}
          </DialogTitle>
          <DialogDescription>
            Reusable email templates can be inserted when logging emails or
            added to sequences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. First touch cold outreach"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-category">Category</Label>
              <Input
                id="tpl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Outreach, Follow-up, Nurture"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question about {{company}}"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder={
                "Hi {{first_name}},\n\nI noticed {{company}} is..."
              }
            />
            <p className="text-xs text-muted-foreground">
              Supported variables:{" "}
              <code className="rounded bg-muted px-1">{"{{first_name}}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{{last_name}}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{{company}}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{{account_name}}"}</code>
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="tpl-shared" className="cursor-pointer">
                Share with team
              </Label>
              <p className="text-xs text-muted-foreground">
                Shared templates are visible to all users.
              </p>
            </div>
            <Switch
              id="tpl-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : template ? "Save Changes" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
