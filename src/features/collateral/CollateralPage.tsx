// The Collateral page: Jordan's v1.1 spec (2026-08-11).
//
// Pulse is a VIEWER of the SharePoint Sales Collateral library: the tab
// reads the mirror, exposes zero write paths (§3), and lives in exactly
// one place: this admin-gated route (§2). The look is the Medcurity
// platform's light language (§4), scoped entirely to .collat-* classes in
// collateral.css; nothing shared is restyled (§0). The page header keeps
// Pulse's placement (title top-left, actions top-right) but is composed
// locally so the shared PageHeader component stays untouched.

import { useEffect } from "react";
import { ArrowRight, FolderOpen, RefreshCw } from "lucide-react";
import { useRequestDialog } from "@/features/requests/RequestDialogProvider";
import { CollateralLibrary } from "./CollateralLibrary";
import { useSyncCollateral } from "./api";
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
            {/* The one teal primary (§4): a request to admins, not a write. */}
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

        {isAdmin && (
          <p className="collat-meta flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            Curation lives in SharePoint: upload, tag, and set Status there.
            Files marked Current appear here on the next sync. Pulse never
            writes to the library.
          </p>
        )}
      </div>
    </div>
  );
}
