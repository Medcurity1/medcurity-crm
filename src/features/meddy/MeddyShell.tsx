// Shared shell for the two Meddy streams — Website (/meddy) and Platform
// (/support). One Meddy home, two streams (Nathan 2026-07-02): Website =
// marketing-site chats; Platform = app.medcurity.com support chats. Some
// staff handle both, so the switcher lives in a shared header instead of
// a second nav tab, and both pages share the same pane sizing.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Outer pane sizing shared by /meddy and /support. */
export const MEDDY_PANE_CLASS = "flex h-[calc(100dvh-8rem)] min-h-[480px] flex-col";

type MeddyStream = "website" | "platform";

const STREAMS: { key: MeddyStream; label: string; to: string }[] = [
  { key: "website", label: "Website", to: "/meddy" },
  { key: "platform", label: "Platform", to: "/support" },
];

const SUBTITLES: Record<MeddyStream, string> = {
  website: "Website chat assistant — conversations, takeover, and history",
  platform:
    "Platform (app.medcurity.com) chats — take over when a customer needs a human, hand back when you're done",
};

/** The Website | Platform pill switcher. */
export function MeddyStreamSwitcher({ active }: { active: MeddyStream }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
      {STREAMS.map((s) =>
        s.key === active ? (
          <span
            key={s.key}
            className="rounded-md bg-background px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-border"
          >
            {s.label}
          </span>
        ) : (
          <Link
            key={s.key}
            to={s.to}
            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {s.label}
          </Link>
        ),
      )}
    </div>
  );
}

/** Shared page header: title + stream switcher on the left, optional
 * per-page controls (e.g. the Conversations | History pills) on the right,
 * and a stream-specific subtitle below. */
export function MeddyHeader({
  stream,
  rightSlot,
}: {
  stream: MeddyStream;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Meddy</h1>
          <MeddyStreamSwitcher active={stream} />
        </div>
        {rightSlot}
      </div>
      <p className="hidden text-sm text-muted-foreground sm:block">{SUBTITLES[stream]}</p>
    </div>
  );
}
