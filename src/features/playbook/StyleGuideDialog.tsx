// View / hand-edit / regenerate the AI-learned newsletter style guide for a
// type. The guide steers every future draft of that newsletter.

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Save } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useNewsletterStyle, useUpdateNewsletterStyle, useGenerateStyle } from "./api";
import type { NewsletterType } from "./types";

const LABEL: Record<string, string> = { report: "The Medcurity Report", partner: "Partner Exclusive" };

export function StyleGuideDialog({
  type, open, onOpenChange,
}: {
  type: NewsletterType | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: style, isLoading } = useNewsletterStyle(open ? type : null);
  const save = useUpdateNewsletterStyle();
  const gen = useGenerateStyle();
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) setText(style?.style_guide ?? "");
  }, [style?.style_guide, open]);

  const dirty = (style?.style_guide ?? "") !== text;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{type ? LABEL[type] : ""} — style guide</DialogTitle>
          <DialogDescription>
            What the AI has learned about this newsletter's voice and structure. Edit it by hand, or regenerate it from
            your recent sends. It's applied to every new draft of this type.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Textarea
            className="flex-1 min-h-[340px] font-mono text-xs"
            placeholder="No style guide yet — click 'Regenerate from sends' to build one from your past issues."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ai"
            disabled={gen.isPending || !type}
            onClick={() => type && gen.mutate(type, { onSuccess: () => { /* query refetch updates text via effect */ } })}
          >
            {gen.isPending
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Learning…</>
              : <><span className="ai-icon mr-1"><Sparkles className="h-4 w-4" /></span> Regenerate from sends</>}
          </Button>
          <Button
            variant="outline"
            disabled={!dirty || save.isPending || !type}
            onClick={() => type && save.mutate({ type, style_guide: text })}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
