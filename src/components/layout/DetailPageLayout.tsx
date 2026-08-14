import {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { cn } from "@/lib/utils";

/**
 * Live CSS media-query state (re-renders on window resize / zoom changes).
 * The initial value is read synchronously so there's no wrong-layout flash.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () =>
    window.matchMedia(query).matches,
  );
}

/**
 * Wraps a detail page body so we can flip between two layouts based on the
 * user's `detailLayout` preference, and optionally render multiple side
 * panels with a simple top-of-panel tab switcher.
 *
 * Usage (single panel — original):
 *   <DetailPageLayout side={<ActivityTimeline accountId={id} compact />}>
 *     ...main body...
 *   </DetailPageLayout>
 *
 * Usage (multiple side panels — new):
 *   <DetailPageLayout
 *     sidePanels={[
 *       { key: "activity", label: "Activity", content: <ActivityTimeline ... /> },
 *       { key: "tasks",    label: "Tasks",    content: <TasksPanel ... /> },
 *     ]}
 *   >
 *     ...main body...
 *   </DetailPageLayout>
 *
 * In side_panel mode the children render in a flex-grow column on the left
 * and the side panel is pinned to a sticky right column. In stacked mode
 * the side content is appended below the children (so we never lose
 * access to it). Side_panel mode additionally requires a 1280px+ viewport;
 * narrower windows get the stacked rendering regardless of preference, so
 * the panel is always reachable.
 */
export interface DetailSidePanel {
  key: string;
  label: string;
  content: ReactNode;
}

export function DetailPageLayout({
  children,
  side,
  sideTitle = "Activity",
  sidePanels,
}: {
  children: ReactNode;
  /** Single-panel mode. Ignored when sidePanels is set. */
  side?: ReactNode;
  sideTitle?: string;
  /** Multi-panel mode with a top-of-panel tab switcher. */
  sidePanels?: DetailSidePanel[];
}) {
  const { prefs } = useUserPreferences();
  // The pinned right column only fits at xl (1280px+). Below that,
  // side_panel mode falls back to the STACKED layout instead of hiding the
  // panel: the old `hidden xl:block` on the aside silently swallowed the
  // whole Activity/Tasks panel on narrow windows and zoomed browsers, and
  // reps read that as their correspondence history being deleted (Jordan
  // 8/14, HRH). Media-query state (not CSS hiding) so the panel content
  // renders exactly once either way.
  const xlUp = useMediaQuery("(min-width: 1280px)");
  const useSidePanel = prefs.detailLayout === "side_panel" && xlUp;

  // Figure out the effective side content.
  const hasMulti = !!sidePanels && sidePanels.length > 0;

  if (!useSidePanel) {
    return (
      <>
        {children}
        <div className="mt-6 space-y-6">
          {hasMulti
            ? sidePanels!.map((p) => (
                <div key={p.key}>
                  <h3 className="text-sm font-semibold mb-3">{p.label}</h3>
                  {p.content}
                </div>
              ))
            : side}
        </div>
      </>
    );
  }

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0">{children}</div>
      <aside
        className={cn(
          // Slightly wider so email From/To addresses + thread subjects
          // don't truncate so aggressively. Only rendered at xl+ (the
          // media-query branch above) — below that the stacked fallback
          // renders instead, so no `hidden` classes here.
          "w-[440px] shrink-0 sticky top-20 self-start"
        )}
      >
        <div className="border rounded-lg p-4 bg-card max-h-[calc(100vh-6rem)] overflow-y-auto">
          {hasMulti ? (
            <SidePanelSwitcher panels={sidePanels!} />
          ) : (
            <>
              <h3 className="text-sm font-semibold mb-3">{sideTitle}</h3>
              {side}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function SidePanelSwitcher({ panels }: { panels: DetailSidePanel[] }) {
  const [active, setActive] = useState(() => {
    // Reminder deep links carry ?open_task=<id>. The handler that pops
    // the task open lives inside the Tasks panel, which doesn't mount
    // until its tab is active — so land on Tasks when the param is
    // present instead of making the user discover the tab switch.
    try {
      if (
        new URLSearchParams(window.location.search).has("open_task") &&
        panels.some((p) => p.key === "tasks")
      ) {
        return "tasks";
      }
    } catch {
      /* fall through to default */
    }
    return panels[0].key;
  });
  const current = panels.find((p) => p.key === active) ?? panels[0];
  return (
    <div>
      <div className="flex items-center gap-1 mb-3 border-b">
        {panels.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setActive(p.key)}
            className={cn(
              "px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors",
              active === p.key
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {current.content}
    </div>
  );
}
