/// <reference types="vite/client" />

/** Injected by vite.config.ts `define` — the current build's identity. */
declare const __BUILD_ID__: string;

interface Window {
  /** Set by main.tsx once the app has mounted; read by the inline
   * boot-recovery script in index.html. */
  __appBooted?: boolean;
  /** Exposed by the inline boot-recovery script in index.html so the boot
   * chain in main.tsx can hand off unrecoverable failures to it. */
  __pulseBootRecover?: () => void;
}
