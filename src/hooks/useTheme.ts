import { useEffect, useState } from "react";

/**
 * Light/dark theme preference, persisted in localStorage.
 *
 * Modes:
 *   "light"  — force light
 *   "dark"   — force dark
 *   "system" — follow the OS setting (prefers-color-scheme)
 *
 * The hook toggles the `.dark` class on <html>, which is what Tailwind v4's
 * custom dark variant (`@custom-variant dark (&:is(.dark *))` in app.css)
 * keys off.
 */
export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "medcurity_theme_mode";

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyDomClass(resolved: "light" | "dark") {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

/**
 * Apply the saved theme as early as possible. Call once at app bootstrap
 * (in main.tsx) to avoid a flash of the wrong theme before the hook mounts.
 */
export function initTheme() {
  if (typeof window === "undefined") return;
  applyDomClass(resolveMode(readMode()));
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readMode());

  // Apply + persist whenever mode changes.
  useEffect(() => {
    applyDomClass(resolveMode(mode));
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage disabled — fine, just skip persistence.
    }
  }, [mode]);

  // If the user picked "system", react to OS-level changes live.
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyDomClass(resolveMode("system"));
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [mode]);

  return {
    mode,
    setMode,
    resolved: resolveMode(mode),
  };
}
