import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateActivity } from "./api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface QuickTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
}

export function QuickTaskDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  opportunityId,
}: QuickTaskDialogProps) {
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const createMutation = useCreateActivity();

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setSubject("");
      setDueDate("");
      setNotes("");
    }
    onOpenChange(nextOpen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;

    createMutation.mutate(
      {
        activity_type: "task",
        subject: subject.trim(),
        body: notes.trim() || undefined,
        due_at: dueDate || null,
        account_id: accountId ?? null,
        contact_id: contactId ?? null,
        opportunity_id: opportunityId ?? null,
      },
      {
        onSuccess: () => {
          toast.success("Task created");
          handleClose(false);
        },
        onError: (err) => {
          toast.error("Failed to create task: " + (err as Error).message);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>
            Create a new task for this record.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-subject">Subject *</Label>
            <Input
              id="task-subject"
              placeholder="e.g. Follow up on proposal"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due">Due Date</Label>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              placeholder="Additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!subject.trim() || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
