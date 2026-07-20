/**
 * The running build's identity, stamped by vite.config.ts `define` (the CI
 * commit sha, or a `local-*` id for dev builds). The deployed server exposes
 * the same value at /version.json, so a client can ask "is there a newer
 * build than me?" — used by the boot recovery in index.html and the
 * UpdateBanner. Guarded so plain tsc/vitest (no Vite define) still work.
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "local-dev";
