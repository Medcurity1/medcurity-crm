import { useState } from "react";
import { StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCreateActivity } from "./api";

interface QuickNoteInputProps {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
}

export function QuickNoteInput({
  accountId,
  contactId,
  opportunityId,
  leadId,
}: QuickNoteInputProps) {
  const { user } = useAuth();
  const createMutation = useCreateActivity();
  const [text, setText] = useState("");

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const firstLine = trimmed.split("\n")[0].slice(0, 60);
    try {
      await createMutation.mutateAsync({
        activity_type: "note",
        subject: firstLine || "Note",
        body: trimmed,
        account_id: accountId,
        contact_id: contactId,
        opportunity_id: opportunityId,
        lead_id: leadId,
        owner_user_id: user?.id,
      });
      setText("");
      toast.success("Note added");
    } catch (err) {
      toast.error("Failed to save note: " + (err as Error).message);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
        <StickyNote className="h-4 w-4" />
        Add a note...
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Quick note about this record..."
        rows={3}
        className="mb-2 resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
            Ctrl+Enter
          </kbd>
        </span>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!text.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
