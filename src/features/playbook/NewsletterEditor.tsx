// NewsletterEditor — a wide two-pane workspace: a large rendered preview (as
// the recipient sees it) with a Preview/HTML toggle on the left, and editing
// controls on the right (subject/preview with AI redo + counters, graphics
// upload, AI revise, train-the-AI, and push-to-Mailchimp).

import { useEffect, useRef, useState } from "react";
import {
  Loader2, Sparkles, Save, Send, ExternalLink, Wand2, ImagePlus, Brain, Code2, Eye,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useNewsletter,
  useReviseNewsletter,
  useSaveNewsletterHtml,
  usePushNewsletterToMailchimp,
  useRewriteField,
  useReplacePlaceholder,
  useInsertImage,
  useAddNewsletterTraining,
  fileToBase64,
} from "./api";
import type { NewsletterType } from "./types";

interface Props {
  id: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function CharCount({ value, soft, hard }: { value: string; soft: number; hard: number }) {
  const n = value.length;
  const color = n > hard ? "text-destructive" : n > soft ? "text-amber-600" : "text-muted-foreground";
  return <span className={cn("text-[10px] tabular-nums", color)}>{n}/{hard}</span>;
}

export function NewsletterEditor({ id, open, onOpenChange }: Props) {
  const { data: nl, isLoading } = useNewsletter(open ? id : null);
  const revise = useReviseNewsletter();
  const save = useSaveNewsletterHtml();
  const push = usePushNewsletterToMailchimp();
  const redo = useRewriteField();
  const replacePlaceholder = useReplacePlaceholder();
  const insertImage = useInsertImage();
  const train = useAddNewsletterTraining();

  const [subject, setSubject] = useState("");
  const [preview, setPreview] = useState("");
  const [html, setHtml] = useState("");
  const [view, setView] = useState<"preview" | "html">("preview");
  const [instruction, setInstruction] = useState("");
  const [trainNote, setTrainNote] = useState("");
  const [pushed, setPushed] = useState<{ url: string; recipient_count: number | null; audience_empty?: boolean; recommended_send: { label: string; time_label: string } | null; segment_warning?: boolean } | null>(null);

  // Hidden file input shared by all image uploads; pendingUpload says where it goes.
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ kind: "placeholder"; index: number; alt: string } | { kind: "insert" } | null>(null);

  useEffect(() => {
    if (nl) {
      setSubject(nl.subject ?? "");
      setPreview(nl.preview_text ?? "");
      setHtml(nl.html_content ?? "");
      setPushed(null);
      setView("preview");
    }
  }, [nl?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!nl && (subject !== (nl.subject ?? "") || preview !== (nl.preview_text ?? "") || html !== (nl.html_content ?? ""));
  const alreadyPushed = nl?.status === "mailchimp_draft" || !!nl?.mailchimp_campaign_id;
  const type = (nl?.newsletter_type ?? "report") as NewsletterType;

  // Graphic placeholders the AI left for the user to fill.
  const placeholders = [...html.matchAll(/\[GRAPHIC:([^\]]*)\]/gi)].map((m, i) => ({ index: i, desc: m[1].trim() }));

  function onSave() {
    if (id) save.mutate({ id, subject, preview_text: preview, html });
  }
  function onRevise() {
    if (!id || !instruction.trim()) return;
    revise.mutate({ id, instruction: instruction.trim() }, {
      onSuccess: (r) => { setSubject(r.subject); setPreview(r.preview_text); setHtml(r.html); setInstruction(""); },
    });
  }
  function onPush() {
    if (id) push.mutate(id, { onSuccess: (r) => { if (r.success) setPushed({ url: r.url, recipient_count: r.recipient_count, audience_empty: r.audience_empty, recommended_send: r.recommended_send, segment_warning: r.segment_warning }); } });
  }
  function pickFile(target: NonNullable<typeof pendingUpload.current>) {
    pendingUpload.current = target;
    fileRef.current?.click();
  }
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = pendingUpload.current;
    pendingUpload.current = null;
    if (!file || !id || !target) return;
    const file_data = await fileToBase64(file);
    if (target.kind === "placeholder") {
      replacePlaceholder.mutate(
        { id, index: target.index, name: file.name, file_data, alt: target.alt },
        { onSuccess: (r) => setHtml(r.html) },
      );
    } else {
      insertImage.mutate(
        { id, name: file.name, file_data, alt: "" },
        { onSuccess: (r) => setHtml(r.html) },
      );
    }
  }

  const uploading = replacePlaceholder.isPending || insertImage.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] sm:max-w-[1400px] h-[92vh] flex flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>Newsletter draft</DialogTitle>
          <DialogDescription>
            Edit the copy, swap in graphics, ask the AI to revise, then push it into Mailchimp as a draft. You always
            send the final from Mailchimp.
          </DialogDescription>
        </DialogHeader>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />

        {isLoading || !nl ? (
          <div className="space-y-2"><Skeleton className="h-8 w-1/2" /><Skeleton className="flex-1 min-h-[400px] w-full" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4 flex-1 min-h-0">
            {/* LEFT — preview / HTML */}
            <div className="border rounded-md overflow-hidden bg-white min-h-0 flex flex-col">
              <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1">
                <div className="inline-flex rounded-md border bg-background p-0.5">
                  <button
                    type="button"
                    className={cn("px-2 py-0.5 text-xs rounded inline-flex items-center gap-1", view === "preview" && "bg-secondary")}
                    onClick={() => setView("preview")}
                  ><Eye className="h-3 w-3" /> Preview</button>
                  <button
                    type="button"
                    className={cn("px-2 py-0.5 text-xs rounded inline-flex items-center gap-1", view === "html" && "bg-secondary")}
                    onClick={() => setView("html")}
                  ><Code2 className="h-3 w-3" /> HTML</button>
                </div>
                {view === "html" && (
                  <Button size="sm" variant="outline" className="h-6 text-xs" disabled={!dirty || save.isPending} onClick={onSave}>
                    Apply HTML changes
                  </Button>
                )}
              </div>
              {view === "preview" ? (
                <iframe title="Newsletter preview" srcDoc={html} className="w-full flex-1 min-h-[420px]" sandbox="" />
              ) : (
                <Textarea
                  className="flex-1 min-h-[420px] rounded-none border-0 font-mono text-[11px] leading-snug resize-none bg-white text-slate-900"
                  spellCheck={false}
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                />
              )}
            </div>

            {/* RIGHT — controls */}
            <div className="space-y-3 overflow-y-auto pr-1 min-h-0">
              {/* Subject */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="nl-subject" className="text-xs">Subject</Label>
                  <div className="flex items-center gap-2">
                    <CharCount value={subject} soft={50} hard={70} />
                    <Button
                      variant="ai" size="xs" className="h-6"
                      disabled={redo.isPending}
                      onClick={() => id && redo.mutate({ id, field: "subject" }, { onSuccess: (r) => setSubject(r.value) })}
                    >
                      {redo.isPending && redo.variables?.field === "subject"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><span className="ai-icon"><Wand2 className="h-3 w-3" /></span></>}
                    </Button>
                  </div>
                </div>
                <Input id="nl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>

              {/* Preview text */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="nl-preview" className="text-xs">Preview text</Label>
                  <div className="flex items-center gap-2">
                    <CharCount value={preview} soft={90} hard={130} />
                    <Button
                      variant="ai" size="xs" className="h-6"
                      disabled={redo.isPending}
                      onClick={() => id && redo.mutate({ id, field: "preview" }, { onSuccess: (r) => setPreview(r.value) })}
                    >
                      {redo.isPending && redo.variables?.field === "preview"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><span className="ai-icon"><Wand2 className="h-3 w-3" /></span></>}
                    </Button>
                  </div>
                </div>
                <Input id="nl-preview" value={preview} onChange={(e) => setPreview(e.target.value)} />
              </div>

              <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save edits
              </Button>

              {/* Graphics */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Graphics</Label>
                {placeholders.length > 0 ? (
                  placeholders.map((p) => (
                    <div key={p.index} className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2">
                      <span className="text-[11px] text-muted-foreground truncate">{p.desc || `Graphic ${p.index + 1}`}</span>
                      <Button size="xs" variant="outline" disabled={uploading}
                        onClick={() => pickFile({ kind: "placeholder", index: p.index, alt: p.desc })}>
                        <ImagePlus className="h-3 w-3 mr-1" /> Upload
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-muted-foreground">No graphic placeholders. Use "Add image" to drop one in.</p>
                )}
                <Button size="sm" variant="outline" disabled={uploading} onClick={() => pickFile({ kind: "insert" })}>
                  {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
                  Add image
                </Button>
              </div>

              {/* AI revise */}
              <div className="space-y-1 pt-2 border-t">
                <Label htmlFor="nl-instr" className="text-xs">Ask the AI to revise the body</Label>
                <Textarea
                  id="nl-instr" rows={3}
                  placeholder="e.g. Shorten the intro and make the CTA about the July webinar."
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <Button variant="ai" size="sm" onClick={onRevise} disabled={!instruction.trim() || revise.isPending}>
                  {revise.isPending
                    ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Revising… (up to ~2 min)</>
                    : <><span className="ai-icon mr-1"><Sparkles className="h-4 w-4" /></span> Revise</>}
                </Button>
              </div>

              {/* Train the AI */}
              <div className="space-y-1 pt-2 border-t">
                <Label htmlFor="nl-train" className="text-xs flex items-center gap-1"><Brain className="h-3 w-3" /> Train the AI for future {type === "report" ? "Reports" : "Partner Exclusives"}</Label>
                <Textarea
                  id="nl-train" rows={2}
                  placeholder="e.g. Always put the webinar callout near the top. Keep the tone warmer."
                  value={trainNote}
                  onChange={(e) => setTrainNote(e.target.value)}
                />
                <Button size="sm" variant="outline" disabled={!trainNote.trim() || train.isPending}
                  onClick={() => train.mutate({ type, note: trainNote.trim() }, { onSuccess: () => setTrainNote("") })}>
                  {train.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Save training note
                </Button>
              </div>

              {/* Push */}
              <div className="pt-2 border-t space-y-2">
                {pushed ? (
                  <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
                    <p className="font-medium text-emerald-800">Pushed to Mailchimp as a draft.</p>
                    {pushed.recipient_count != null && pushed.recipient_count > 0 && <p>Audience: ~{pushed.recipient_count} recipients.</p>}
                    {pushed.audience_empty && (
                      <p className="text-amber-700">⚠ Mailchimp shows <strong>0 recipients</strong> for this draft — the audience didn't attach. Open it in Mailchimp and set the audience before sending.</p>
                    )}
                    {pushed.segment_warning && (
                      <p className="text-amber-700">⚠ The original used an advanced Mailchimp segment we can't copy — the draft is on the full list. <strong>Set the audience in Mailchimp before sending.</strong></p>
                    )}
                    {pushed.recommended_send && <p>Suggested send: {pushed.recommended_send.label} at {pushed.recommended_send.time_label}.</p>}
                    {pushed.url && (
                      <a href={pushed.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                        Finish + send in Mailchimp <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ) : (
                  <>
                    <Button size="sm" onClick={onPush} disabled={push.isPending || dirty}>
                      {push.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                      Push to Mailchimp
                    </Button>
                    {dirty && <p className="text-xs text-muted-foreground">Save your edits before pushing.</p>}
                    {alreadyPushed && <p className="text-xs text-amber-600">Already pushed once — pushing again creates another Mailchimp draft.</p>}
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
