import { useState } from "react";
import { Sparkles, Send, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Placeholder AI assistant dialog. Not yet wired to a live model — the
 * goal is a clear scaffold Brayden can see in the top bar and that we
 * can swap in a Claude / Anthropic edge function call behind later.
 *
 * When wired up, prompts like "qualify my leads as hot/warm/cold" or
 * "run a report of Q3 closed-won by rep" would get routed to a Claude
 * API edge function with tool access to read-only CRM views + a
 * narrow set of write actions (lead.qualification, report
 * generation). Data integrity is protected by limiting tool calls
 * to a curated allowlist and showing a diff/preview before any write.
 */
export function AiAssistantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");

  function handleSubmit() {
    // Wired to a backend edge function later. For now, acknowledge.
    setPrompt("");
    onOpenChange(false);
  }

  const examples = [
    "Qualify my leads as hot, warm, or cold based on activity in the last 30 days",
    "Run a Closed Won report for this quarter grouped by owner",
    "Which accounts haven't had any activity in 60+ days?",
    "Draft a follow-up email for all prospects that asked about SRA pricing",
    "Summarize the activity on Acme Corp this month",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Assistant
          </DialogTitle>
          <DialogDescription>
            Ask in plain English. The assistant will read your CRM data and
            either answer directly, preview a change for you to confirm, or
            run a report.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-900 p-3 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1">
            <Lightbulb className="h-4 w-4" />
            Preview
          </p>
          <p className="text-amber-900 dark:text-amber-300 text-xs mt-1">
            Backend isn't wired yet — this is a UI placeholder so reps get
            familiar with the entry point. Prompts here don't actually run
            anything yet.
          </p>
        </div>

        <div className="space-y-2">
          <Textarea
            rows={4}
            placeholder="Ask the assistant..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Try asking
          </p>
          <div className="space-y-1">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                className="w-full text-left text-xs text-blue-600 hover:underline"
                onClick={() => setPrompt(ex)}
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!prompt.trim()}>
            <Send className="h-4 w-4 mr-1" />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
