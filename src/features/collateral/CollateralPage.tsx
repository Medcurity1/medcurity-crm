// The Collateral page: Jordan's v1.1 spec + v1.2 design tweaks
// (2026-08-11 docx).
//
// Pulse is a VIEWER of the SharePoint Sales Collateral library: the tab
// reads the mirror and exposes zero write paths (§3). Since v1.2 change 7
// the route is open to EVERY signed-in user — the tab shows only assets
// an admin promoted to Current, so there is nothing here a rep should
// not see. Sync SharePoint stays admin-only (curation action); Request
// collateral stays for everyone (the rep-facing path). The look is the
// Medcurity platform's light language (§4), scoped entirely to .collat-*
// classes in collateral.css; nothing shared is restyled (§0). The page
// header keeps Pulse's placement (title top-left, actions top-right) but
// is composed locally so the shared PageHeader component stays untouched.

import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Sparkles, X } from "lucide-react";
import { useRequestDialog } from "@/features/requests/RequestDialogProvider";
import { CollateralLibrary } from "./CollateralLibrary";
import { useDismissLaunchBanner, useMyCollateralPrefs, useSyncCollateral } from "./api";
import { launchBannerActive } from "./collateral-logic";
import { useAuth } from "@/features/auth/AuthProvider";
import "./collateral.css";

/** Load Plus Jakarta Sans for this route only (§4 typography). The link
 * is injected once and scoped in effect: only .collat-root uses the
 * family, with system-ui fallbacks if the fetch is blocked. */
function useJakartaFont() {
  useEffect(() => {
    const id = "collat-jakarta-font";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
  }, []);
}

/** v1.2 change 8: a dismissible launch announcement for the tab's new
 * general audience. Dismissal persists per user; the banner also retires
 * on its own ~30 days after the release (launchBannerActive). */
function LaunchBanner() {
  const { data: prefs } = useMyCollateralPrefs();
  const dismiss = useDismissLaunchBanner();
  const [hidden, setHidden] = useState(false);

  // Wait for the pref row before showing anything: no flash-then-vanish
  // for users who already dismissed it.
  if (hidden || !prefs || prefs.launch_banner_dismissed_at || !launchBannerActive()) {
    return null;
  }

  return (
    <div className="collat-banner" role="status">
      <span className="collat-banner-pill">
        <Sparkles className="h-3 w-3" /> New
      </span>
      <p>
        <strong>Collateral.</strong> Every current sales asset in one place.
        Search it, copy a link, paste it into your email.
      </p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          setHidden(true);
          dismiss.dismiss();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function CollateralPage() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(
    ((profile as { role?: string } | null)?.role ?? ""),
  );
  const { openRequestDialog } = useRequestDialog();
  const sync = useSyncCollateral();
  useJakartaFont();

  return (
    <div className="collat-root mx-auto max-w-6xl">
      <div className="collat-canvas space-y-4">
        <LaunchBanner />

        {/* Hero: the page's single warm moment (§4). */}
        <div className="collat-hero flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1>Collateral</h1>
            <p>
              The Sales Collateral library, ready to send. Search it, copy a
              link, drop it in your email.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Admin-only curation action (v1.2 change 7: reps never see
                it — it reads as a button they're not sure they may press). */}
            {isAdmin && (
              <button
                type="button"
                className="collat-btn-secondary"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <RefreshCw className={sync.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {sync.isPending ? "Syncing…" : "Sync SharePoint"}
              </button>
            )}
            {/* The one teal primary (§4): a request to admins, not a write.
                Visible to everyone — it's the rep-facing path. */}
            <button
              type="button"
              className="collat-btn-primary"
              onClick={() => openRequestDialog("collateral")}
            >
              Request collateral
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <CollateralLibrary />

        {/* v1.2 change 10 removed the old curation footer line: admin
            process copy is noise for the tab's general audience. */}
      </div>
    </div>
  );
}
