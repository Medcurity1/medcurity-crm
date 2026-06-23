// NewsletterEditor — edit + preview an AI newsletter draft, AI-revise it,
// then push it into Mailchimp as a DRAFT (a human sends from Mailchimp).

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Save, Send, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNewsletter,
  useReviseNewsletter,
  useSaveNewsletterHtml,
  usePushNewsletterToMailchimp,
} from "./api";

interface Props {
  id: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewsletterEditor({ id, open, onOpenChange }: Props) {
  const { data: nl, isLoading } = useNewsletter(open ? id : null);
  const revise = useReviseNewsletter();
  const save = useSaveNewsletterHtml();
  const push = usePushNewsletterToMailchimp();

  const [subject, setSubject] = useState("");
  const [preview, setPreview] = useState("");
  const [html, setHtml] = useState("");
  const [instruction, setInstruction] = useState("");
  const [pushed, setPushed] = useState<{ url: string; recipient_count: number | null; recommended_send: { label: string; time_label: string } | null } | null>(null);

  // Hydrate local state when the newsletter loads.
  useEffect(() => {
    if (nl) {
      setSubject(nl.subject ?? "");
      setPreview(nl.preview_text ?? "");
      setHtml(nl.html_content ?? "");
      setPushed(null);
    }
  }, [nl?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = nl && (subject !== (nl.subject ?? "") || preview !== (nl.preview_text ?? "") || html !== (nl.html_content ?? ""));
  const alreadyPushed = nl?.status === "mailchimp_draft" || !!nl?.mailchimp_campaign_id;

  function onRevise() {
    if (!id || !instruction.trim()) return;
    revise.mutate(
      { id, instruction: instruction.trim() },
      {
        onSuccess: (r) => {
          setSubject(r.subject);
          setPreview(r.preview_text);
          setHtml(r.html);
          setInstruction("");
        },
      },
    );
  }

  function onSave() {
    if (!id) return;
    save.mutate({ id, subject, preview_text: preview, html });
  }

  function onPush() {
    if (!id) return;
    push.mutate(id, {
      onSuccess: (r) => {
        if (r.success) {
          setPushed({ url: r.url, recipient_count: r.recipient_count, recommended_send: r.recommended_send });
        }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Newsletter draft</DialogTitle>
          <DialogDescription>
            Edit the copy, ask the AI to revise, then push it into Mailchimp as a draft. You always send the final from Mailchimp.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !nl ? (
          <div className="space-y-2"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64 w-full" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden flex-1 min-h-0">
            {/* Live preview */}
            <div className="border rounded-md overflow-hidden bg-white min-h-0 flex flex-col">
              <div className="text-xs text-muted-foreground px-2 py-1 border-b bg-muted/40">Preview</div>
              <iframe
                title="Newsletter preview"
                srcDoc={html}
                className="w-full flex-1 min-h-[400px]"
                sandbox=""
              />
            </div>

            {/* Controls */}
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="space-y-1">
                <Label htmlFor="nl-subject" className="text-xs">Subject</Label>
                <Input id="nl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nl-preview" className="text-xs">Preview text</Label>
                <Input id="nl-preview" value={preview} onChange={(e) => setPreview(e.target.value)} />
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty || save.isPending}>
                  {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save edits
                </Button>
              </div>

              <div className="space-y-1 pt-2 border-t">
                <Label htmlFor="nl-instr" className="text-xs">Ask the AI to revise</Label>
                <Textarea
                  id="nl-instr"
                  rows={3}
                  placeholder="e.g. Shorten the intro and make the CTA about the webinar."
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <Button size="sm" onClick={onRevise} disabled={!instruction.trim() || revise.isPending}>
                  {revise.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                  Revise
                </Button>
              </div>

              <div className="pt-2 border-t space-y-2">
                {pushed ? (
                  <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
                    <p className="font-medium text-emerald-800">Pushed to Mailchimp as a draft.</p>
                    {pushed.recipient_count != null && <p>Audience: ~{pushed.recipient_count} recipients.</p>}
                    {pushed.recommended_send && (
                      <p>Suggested send: {pushed.recommended_send.label} at {pushed.recommended_send.time_label}.</p>
                    )}
                    {pushed.url && (
                      <a href={pushed.url} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1">
                        Finish + send in Mailchimp <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ) : (
                  <>
                    <Button size="sm" onClick={onPush} disabled={push.isPending || (dirty ?? false)}>
                      {push.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Push to Mailchimp
                    </Button>
                    {dirty && <p className="text-xs text-muted-foreground">Save your edits before pushing.</p>}
                    {alreadyPushed && (
                      <p className="text-xs text-amber-600">This draft was already pushed once — pushing again creates another Mailchimp draft.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
