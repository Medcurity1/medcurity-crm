// Visual read-only timeline of a sequence's steps — the heart of the Campaigns
// builder look. A vertical, scannable cadence: channel icon + day + action +
// who does it (auto vs your task). Editing lands in a later phase.

import { Mail, MailCheck, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SequenceStep, SequenceChannel } from "./types";

const CHANNEL: Record<SequenceChannel, { icon: typeof Mail; label: string; badge: string; line: string }> = {
  EMAIL_AUTO:   { icon: Mail,      label: "Automated email",        badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",     line: "bg-blue-500/30" },
  EMAIL_HYBRID: { icon: MailCheck, label: "Email — you review & send", badge: "bg-violet-500/15 text-violet-600 dark:text-violet-400", line: "bg-violet-500/30" },
  CALL:         { icon: Phone,     label: "Call",                   badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", line: "bg-emerald-500/30" },
  LINKEDIN:     { icon: Users,     label: "LinkedIn",               badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400",       line: "bg-sky-500/30" },
};

// Weekday derived from the day-offset assuming a Monday start (Day 1 = Mon).
// Templates are start-relative, so we compute the weekday from the offset rather
// than trust a hardcoded label — that keeps "Day N · Weekday" always
// self-consistent (the labels in the source doc were internally off).
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayForOffset = (dayOffset: number) => WEEKDAYS[(((dayOffset - 1) % 7) + 7) % 7];

function whoBadge(s: SequenceStep): { text: string; cls: string } {
  if (s.automation === "AUTO") return { text: "Sends automatically", cls: "border-blue-500/30 text-blue-600 dark:text-blue-400" };
  if (s.automation === "HYBRID") return { text: "You review & send", cls: "border-violet-500/30 text-violet-600 dark:text-violet-400" };
  return { text: "Your task", cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" };
}

// Turn a "{{first_name}} @ {{company}}" template into readable preview prose.
function readable(t?: string): string {
  return (t ?? "")
    .replace(/\{\{\s*first_name\s*\}\}/gi, "the contact")
    .replace(/\{\{\s*last_name\s*\}\}/gi, "")
    .replace(/\{\{\s*company\s*\}\}/gi, "their company")
    .replace(/\s+/g, " ")
    .trim();
}

function subtitle(s: SequenceStep): string {
  const note = readable(s.task_note_template);
  if (note) return note;
  if (s.channel === "EMAIL_AUTO" || s.channel === "EMAIL_HYBRID") {
    return s.content_ai_draft ? "AI drafts the copy; tweak spots are easy to edit." : (readable(s.subject_template) || "Email step.");
  }
  return CHANNEL[s.channel].label;
}

export function SequenceTimeline({ steps }: { steps: SequenceStep[] }) {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  return (
    <div className="relative">
      {ordered.map((s, i) => {
        const cfg = CHANNEL[s.channel] ?? CHANNEL.EMAIL_AUTO;
        const Icon = cfg.icon;
        const who = whoBadge(s);
        const dow = ` · ${weekdayForOffset(s.day_offset)}`;
        const window =
          s.send_window_start ? ` · ${s.send_window_start}${s.send_window_end ? "–" + s.send_window_end : ""}` : "";
        return (
          <div key={s.order} className="flex gap-3 pb-3 last:pb-0 relative">
            {i < ordered.length - 1 && (
              <div className={cn("absolute left-[17px] top-9 -bottom-0 w-px", cfg.line)} />
            )}
            <div className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0 z-10", cfg.badge)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 rounded-lg border bg-card px-3 py-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Day {s.day_offset}{dow}{window}
                </span>
                <Badge variant="outline" className={cn("text-[10px] font-medium", who.cls)}>{who.text}</Badge>
              </div>
              <p className="font-medium text-sm mt-0.5">{cfg.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{subtitle(s)}</p>
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
