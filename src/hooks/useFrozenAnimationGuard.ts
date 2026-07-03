import { useEffect } from "react";

/**
 * Hardening for headless / hidden-tab environments (E2E runners, background
 * tabs). When the document produces no frames (`document.hidden`), CSS
 * animations freeze at frame 0 AND their start/end/cancel events never fire
 * (they're dispatched by the frame lifecycle). For this sheet that means:
 * panel parked off-screen at translateX(100%), overlay stuck
 * invisible-but-click-blocking, Select dropdowns stuck at opacity 0, and on
 * close a frozen exit animation wedges the Radix Presence so a ghost dialog
 * stays mounted holding the body-wide pointer-events lock. Every control
 * looks "dead" even though the React tree is perfectly healthy (verified
 * live: no remounts — a DOM marker on the sheet survives across renders).
 *
 * Timers can't repair this either (hidden tabs throttle them to 1-minute
 * wake-ups), and finishing the animations programmatically still fires no
 * events for Radix. So instead: while the document is hidden, neutralize
 * the portal-layer animations entirely via an injected `animation: none`
 * rule — elements then mount/unmount at their resting styles and Radix
 * Presence resolves synchronously. Visible tabs are untouched (the tag is
 * removed on visibilitychange), so real users keep the full animations.
 */
const FROZEN_ANIM_GUARD_ID = "frozen-anim-guard";
let frozenAnimGuardUsers = 0;

function syncFrozenAnimGuard() {
  const existing = document.getElementById(FROZEN_ANIM_GUARD_ID);
  if (!document.hidden) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement("style");
  style.id = FROZEN_ANIM_GUARD_ID;
  style.textContent = `
    [data-slot="sheet-content"],
    [data-slot="sheet-overlay"],
    [data-slot="select-content"],
    [data-slot="popover-content"],
    [data-slot="tooltip-content"],
    [data-slot="dialog-content"],
    [data-slot="dialog-overlay"],
    [data-slot="alert-dialog-content"],
    [data-slot="alert-dialog-overlay"],
    [data-slot="dropdown-menu-content"],
    [data-slot="dropdown-menu-sub-content"] {
      animation: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function useFrozenAnimationGuard() {
  useEffect(() => {
    frozenAnimGuardUsers += 1;
    syncFrozenAnimGuard();
    document.addEventListener("visibilitychange", syncFrozenAnimGuard);
    return () => {
      frozenAnimGuardUsers -= 1;
      document.removeEventListener("visibilitychange", syncFrozenAnimGuard);
      // The admin page mounts several builders — only the last one out
      // removes the tag.
      if (frozenAnimGuardUsers === 0) {
        document.getElementById(FROZEN_ANIM_GUARD_ID)?.remove();
      }
    };
  }, []);
}
