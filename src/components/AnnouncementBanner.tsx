import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { launchBannerActive } from "@/features/collateral/collateral-logic";

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
// (meddy-launch-2026-06) ran 2026-06-16 → 2026-07-02. Banner held
// 2026-07-02 → 2026-08-04 (Nathan: until Joe's platform side was ready).
//
// BACK POCKET — the Platform-stream announcement, ready to flip on by
// assigning it to ACTIVE_ANNOUNCEMENT when Joe's integration goes live:
//   {
//     id: "meddy-platform-2026-07",
//     title: "Meddy now covers platform support",
//     message:
//       "One Meddy home, two streams: website chats and app.medcurity.com support. Flip between them with the Website | Platform switcher.",
//     ctaLabel: "See Platform stream",
//     ctaRoute: "/support",
//   }
// Nexus launch (nexus-launch-2026-08) ran 2026-08-04 → 2026-08-18,
// superseded by the Collateral launch below (one announcement at a time).
//
// Collateral launch (Jordan's v1.2 change 8, reshaped by Nathan 8/18 to
// the standard all-tabs banner): copy is Jordan's suggested launch text.
// Unlike past banners this one RETIRES ITSELF ~30 days after the v1.2
// release via launchBannerActive (spec: the announcement must not outstay
// the launch); flip to another announcement or null any time before that.
const COLLATERAL_LAUNCH: Announcement = {
  id: "collateral-launch-2026-08",
  title: "New: Collateral",
  message:
    "Every current sales asset in one place. Search it, copy a link, paste it into your email.",
  ctaLabel: "Open Collateral",
  ctaRoute: "/collateral",
};

export const ACTIVE_ANNOUNCEMENT: Announcement | null = launchBannerActive()
  ? COLLATERAL_LAUNCH
  : null;

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
      {/* Launch-gradient accent (Nathan 8/18): same sky→indigo family as
          the sidebar's LAUNCHED pill, so the banner and the badge read as
          one launch moment. (The orange era belonged to Nexus.) */}
      <div className="relative mx-auto max-w-[1800px] overflow-hidden rounded-xl border border-sky-500/30 bg-gradient-to-r from-sky-500/15 via-blue-500/10 to-indigo-500/10 px-4 py-3 pr-10 shadow-sm backdrop-blur sm:pr-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ring-1 ring-sky-500/30">
              <Sparkles className="h-5 w-5 text-sky-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:mt-0 sm:truncate sm:text-sm sm:leading-normal">
                {message}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5 bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 text-white shadow-sm shadow-blue-500/30 hover:opacity-90 sm:w-auto sm:shrink-0"
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
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground sm:static sm:shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
