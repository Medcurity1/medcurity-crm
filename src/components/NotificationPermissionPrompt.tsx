// One-time desktop-notification onboarding (ports Nexus's permission
// banner, index.html:11960-11984, restyled as a Pulse card).
//
// Browsers never show notifications until the user clicks Allow in the
// browser's own permission popup — and that popup only appears after WE
// ask. Most of the team will never find the setting on their own, so
// this card asks once, in plain language. "Not now" snoozes it for 14
// days; once the browser remembers an answer (granted OR denied) the
// card never returns.

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const SNOOZE_KEY = "pulse_notif_prompt_snoozed_until";
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

export function NotificationPermissionPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return; // already answered
    if (snoozed()) return;
    // Let the app settle first so this reads as a gentle nudge, not a
    // login gate.
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(
        SNOOZE_KEY,
        String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
      );
    } catch {
      // private mode — it'll just ask again next session
    }
  }

  async function enable() {
    setVisible(false);
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        toast.success("Desktop alerts are on", {
          description: "You'll get a popup even when Pulse is in another tab.",
        });
        // Show one immediately so they see exactly what it looks like.
        try {
          new Notification("You're all set", {
            body: "This is what a Pulse alert looks like.",
            tag: "pulse-perm-test",
          });
        } catch {
          // some browsers require a service worker for this — fine
        }
      } else if (result === "denied") {
        toast("No problem", {
          description:
            "If you change your mind, allow notifications for this site in your browser settings.",
        });
      }
    } catch {
      // requestPermission can throw on very old browsers — ignore
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] rounded-xl border border-border bg-popover p-4 shadow-2xl">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <BellRing className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Turn on desktop alerts?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Pulse can pop up an alert when something needs you — like a website
            visitor asking to talk to a person — even when you're in another
            tab. Your browser will ask once; just click <strong>Allow</strong>.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={enable}>
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
