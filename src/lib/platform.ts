/**
 * Platform detection + platform-specific shortcut labels.
 *
 * Sticks with runtime detection (userAgent/platform) rather than relying on
 * build-time flags so the same bundle works for everyone. SSR-safe: falls
 * back to "other" when window is missing.
 */

export type Platform = "mac" | "windows" | "linux" | "other";

export function getPlatform(): Platform {
  if (typeof window === "undefined") return "other";
  const ua = window.navigator.userAgent.toLowerCase();
  // navigator.platform is deprecated but still reliable enough for this.
  const plat = (window.navigator.platform || "").toLowerCase();
  if (plat.includes("mac") || ua.includes("mac os")) return "mac";
  if (plat.includes("win") || ua.includes("windows")) return "windows";
  if (plat.includes("linux") || ua.includes("linux")) return "linux";
  return "other";
}

export function isMacPlatform(): boolean {
  return getPlatform() === "mac";
}

/**
 * Returns the display string for the primary modifier key on this platform.
 * ⌘ on Mac, "Ctrl" on Windows/Linux.
 */
export function modKeyLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}

/**
 * Convenience: format a shortcut like "Cmd+K" with the right mod key symbol
 * for the current platform. Pass just the non-mod portion ("K", "/", etc.)
 */
export function formatModShortcut(key: string): string {
  return isMacPlatform() ? `\u2318${key}` : `Ctrl+${key}`;
}
