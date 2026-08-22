// Compact sequence timeline. Rows stay collapsed until a user opens one.

import { useState } from "react";
import { ChevronDown, Mail, MailCheck, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SequenceStep, SequenceChannel } from "./types";
import { firstMeaningfulLine, formatSequenceWhen, sequenceStepHeadline } from "./campaign-launch";

const CHANNEL: Record<SequenceChannel, { icon: typeof Mail; label: string; badge: string; line: string }> = {
  EMAIL_AUTO:   { icon: Mail,      label: "Automated email",        badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",     line: "bg-blue-500/30" },
  EMAIL_HYBRID: { icon: MailCheck, label: "Email: you review and send", badge: "bg-violet-500/15 text-violet-600 dark:text-violet-400", line: "bg-violet-500/30" },
  CALL:         { icon: Phone,     label: "Call",                   badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", line: "bg-emerald-500/30" },
  LINKEDIN:     { icon: Users,     label: "LinkedIn",               badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400",       line: "bg-sky-500/30" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayForOffset = (dayOffset: number) => WEEKDAYS[(((dayOffset - 1) % 7) + 7) % 7];

function whoBadge(s: SequenceStep): { text: string; cls: string } {
  if (s.automation === "AUTO") return { text: "Sends automatically", cls: "border-blue-500/30 text-blue-600 dark:text-blue-400" };
  if (s.automation === "HYBRID") return { text: "You review & send", cls: "border-violet-500/30 text-violet-600 dark:text-violet-400" };
  return { text: "Your task", cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" };
}

export interface SequencePreviewContext {
  firstName?: string | null;
  recipientEmail?: string | null;
  organization?: string | null;
  senderName?: string | null;
  phone?: string | null;
}

// Turn a "{{first_name}} @ {{company}}" template into readable preview prose.
// The launch wizard supplies the real selected person + rep when available;
// gallery previews use natural fallback copy instead of leaking raw tokens or
// awkward stand-ins such as "Hi the contact" / "this is you".
export function readableTaskPreview(t?: string, context: SequencePreviewContext = {}): string {
  const firstName = context.firstName?.trim() || context.recipientEmail?.trim() || "there";
  const organization = context.organization?.trim() || "your organization";
  const senderName = context.senderName?.trim() || "the assigned rep";
  const phone = context.phone?.trim() || "the rep's saved work phone";
  const hasFirstName = !!context.firstName?.trim();
  const hasOrganization = !!context.organization?.trim();
  return (t ?? "")
    .replace(/\{\{#if\s+first_name\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/gi, (_block, present, fallback) => hasFirstName ? present : fallback)
    .replace(/\{\{#if\s+(?:company|company_name)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/gi, (_block, present, fallback) => hasOrganization ? present : fallback)
    .replace(/\[\[\s*First name\s*\]\]/gi, firstName)
    .replace(/\[\[\s*Organization\s*\]\]/gi, organization)
    .replace(/\[\[\s*Signature\s*\]\]/gi, senderName)
    .replace(/\[\[\s*Work phone\s*\]\]/gi, phone)
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*last_name\s*\}\}/gi, "")
    .replace(/\{\{\s*(?:company|company_name)\s*\}\}/gi, organization)
    .replace(/\{\{\s*sender_name\s*\}\}/gi, senderName)
    .replace(/\{\{\s*phone\s*\}\}/gi, phone)
    .replace(/\bThanks for connecting, there([.!?])/gi, "Thanks for connecting$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert stored HTML body (the rich-text editor's output) to readable plain
 *  text with paragraph breaks preserved. Does NOT use dangerouslySetInnerHTML
 *  — just tag-to-whitespace conversion + entity decoding. Safe for rendering
 *  in a `whitespace-pre-wrap` `<p>` tag. */
export function htmlToReadableText(html?: string | null): string {
  return (html ?? "")
    // Block-level breaks: </p>, <br>, </div>, </li> → newlines
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|li|blockquote|h[1-6])>/gi, "\n")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities the rich-text editor produces
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // Clean up: collapse runs of spaces/tabs within lines but keep newlines
    .replace(/[ \t]+/g, " ")
    // Collapse 3+ consecutive newlines to double (paragraph break)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function subtitle(s: SequenceStep, context: SequencePreviewContext): string {
  const note = readableTaskPreview(s.task_note_template, context);
  if (note) return note;
  if (s.channel === "EMAIL_AUTO" || s.channel === "EMAIL_HYBRID") {
    return s.content_ai_draft ? "Wording needed before this can launch." : (readableTaskPreview(s.subject_template, context) || "Email step.");
  }
  return CHANNEL[s.channel].label;
}

/** @param fullCopy  When true the timeline shows complete subject/body text
 *  without truncation and every step renders expanded — designed for the
 *  template preview modal where users need to read the full sequence copy.
 *  Compact cards and other callers leave this false (default). */
export function SequenceTimeline({
  steps,
  previewContext = {},
  defaultExpanded = false,
  fullCopy = false,
  onEdit,
}: {
  steps: SequenceStep[];
  previewContext?: SequencePreviewContext;
  defaultExpanded?: boolean;
  /** Show full untruncated copy for every step (preview modal). */
  fullCopy?: boolean;
  onEdit?: (step: SequenceStep) => void;
}) {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const firstEmailOrder = Math.min(
    ...ordered.filter((s) => s.channel === "EMAIL_AUTO").map((s) => s.order),
    Number.POSITIVE_INFINITY,
  );
  const [openOrder, setOpenOrder] = useState<number | null>(defaultExpanded ? (ordered[0]?.order ?? null) : null);
  // In fullCopy mode every step is always expanded and not togglable.
  const isOpen = (order: number) => fullCopy || openOrder === order;
  return (
    <div className="relative">
      {ordered.map((s, i) => {
        const cfg = CHANNEL[s.channel] ?? CHANNEL.EMAIL_AUTO;
        const Icon = cfg.icon;
        const who = whoBadge(s);
        const open = isOpen(s.order);
        // Automated emails send inside the campaign's Smartlead window, not
        // at a per-step hour — printing the step's stored clock times there
        // would advertise a control that doesn't exist (Nathan 8/19). Task
        // steps keep their time: it's when the task comes due.
        const when = s.channel === "EMAIL_AUTO"
          ? formatSequenceWhen(s.day_offset, weekdayForOffset(s.day_offset))
          : formatSequenceWhen(s.day_offset, weekdayForOffset(s.day_offset), s.send_window_start, s.send_window_end);
        const headline = sequenceStepHeadline({
          channel: s.channel,
          subject: readableTaskPreview(s.subject_template, previewContext) || s.subject_template,
          isFirstEmail: s.channel === "EMAIL_AUTO" && s.order === firstEmailOrder,
        });
        const preview = firstMeaningfulLine(readableTaskPreview(s.body_template || s.task_note_template, previewContext) || s.body_template || s.task_note_template);
        // fullCopy: substitute variables, then convert HTML → readable plain
        // text preserving paragraph/br breaks. readableTaskPreview handles
        // variable substitution (its whitespace collapse is harmless here
        // because htmlToReadableText re-derives structure from the surviving
        // HTML tags). Falls back to the raw template if substitution empties.
        const fullBodyText = fullCopy
          ? htmlToReadableText(readableTaskPreview(s.body_template || s.task_note_template, previewContext) || s.body_template || s.task_note_template || "")
          : "";
        const wrapClass = fullCopy ? "break-words [overflow-wrap:anywhere]" : "truncate";
        return (
          <div key={s.order} className="flex gap-3 pb-2 last:pb-0 relative">
            {i < ordered.length - 1 && (
              <div className={cn("absolute left-[15px] top-8 -bottom-0 w-px", cfg.line)} />
            )}
            <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10", cfg.badge)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0 rounded-xl bg-card/80 px-3 py-2.5 shadow-sm">
              <div className={cn("flex items-center gap-2", fullCopy && "flex-wrap")}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => !fullCopy && setOpenOrder(open ? null : s.order)}
                  className={cn(
                    "min-w-0 flex-1 text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md",
                    fullCopy && "cursor-default hover:opacity-100",
                  )}
                >
                  <p className={cn("font-medium text-sm", wrapClass)}>{headline}</p>
                  <p className="text-xs text-muted-foreground">{when} · {cfg.label}</p>
                  {preview && !open && (
                    <p className={cn("text-xs text-muted-foreground mt-0.5", wrapClass)}>{preview}</p>
                  )}
                </button>
                <Badge variant="outline" className={cn("hidden sm:inline-flex text-xs font-medium shrink-0", who.cls)}>{who.text}</Badge>
                {onEdit && (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1"
                    onClick={() => onEdit(s)}
                  >
                    Edit
                  </button>
                )}
                {!fullCopy && (
                  <button
                    type="button"
                    aria-label={open ? "Collapse step" : "Expand step"}
                    onClick={() => setOpenOrder(open ? null : s.order)}
                    className="shrink-0 rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </button>
                )}
              </div>
              {open && (
                <div className="mt-2 space-y-1">
                  <Badge variant="outline" className={cn("sm:hidden text-xs font-medium", who.cls)}>{who.text}</Badge>
                  {fullCopy ? (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {fullBodyText || subtitle(s, previewContext) || "No copy yet."}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{subtitle(s, previewContext) || preview || "No copy yet."}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Tiny channel-dot row for template gallery cards. */
export function SequenceMiniPreview({ steps }: { steps: SequenceStep[] }) {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  return (
    <div className="flex items-center gap-1">
      {ordered.map((s) => {
        const cfg = CHANNEL[s.channel] ?? CHANNEL.EMAIL_AUTO;
        const Icon = cfg.icon;
        return (
          <span key={s.order} className={cn("h-5 w-5 rounded-full flex items-center justify-center", cfg.badge)}>
            <Icon className="h-3 w-3" />
          </span>
        );
      })}
    </div>
  );
}
