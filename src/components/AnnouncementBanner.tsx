import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Announcement {
  /** Bump this whenever you want a brand-new banner everyone sees once. */
  id: string;
  title: string;
  message: string;
  ctaLabel: string;
  ctaRoute: string;
}

/**
 * The currently-active product announcement. Set to `null` to show
 * nothing. Reusable for any future "new feature" nudge: just change the
 * fields and give it a fresh `id` so previously-dismissed users see it
 * again.
 *
 * Dismissal is remembered per-device in localStorage, so once a user
 * clicks the X or the call-to-action, the banner never reappears for
 * that announcement.
 */
// Requests launch banner retired 2026-06-12 (Nathan). Meddy launch banner
// turned on 2026-06-16 when Meddy went live (website chat now points at the
// CRM). Bump the id if we ever want to re-show it.
export const ACTIVE_ANNOUNCEMENT: Announcement | null = {
  id: "meddy-launch-2026-06",
  title: "New: Meddy is live",
  message:
    "Meddy, your website chat command center, is here. See website conversations as they come in, jump in to chat with a visitor, and review past chats — all inside the CRM.",
  ctaLabel: "Meet Meddy",
  ctaRoute: "/meddy",
};

function storageKey(id: string) {
  return `announcement-dismissed:${id}`;
}

export function AnnouncementBanner() {
  const navigate = useNavigate();
  const ann = ACTIVE_ANNOUNCEMENT;
  const [dismissed, setDismissed] = useState(() => {
    if (!ann || typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(storageKey(ann.id)) === "1";
    } catch {
      return false;
    }
  });

  if (!ann || dismissed) return null;
  const { id, title, message, ctaLabel, ctaRoute } = ann;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey(id), "1");
    } catch {
      /* ignore storage errors */
    }
    setDismissed(true);
  }

  return (
    <div className="px-4 pt-4 sm:px-6">
      <div className="relative mx-auto flex max-w-[1800px] items-center gap-3 overflow-hidden rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/15 via-amber-400/10 to-primary/10 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/20 ring-1 ring-orange-500/30">
          <Sparkles className="h-5 w-5 text-orange-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{message}</p>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1.5 bg-orange-500 text-white hover:bg-orange-600"
          onClick={() => {
            dismiss();
            navigate(ctaRoute);
          }}
        >
          {ctaLabel} <ArrowRight className="h-4 w-4" />
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
