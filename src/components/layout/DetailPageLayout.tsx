import { useState, type ReactNode } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { cn } from "@/lib/utils";

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
 * access to it).
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
  const useSidePanel = prefs.detailLayout === "side_panel";

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
          // don't truncate so aggressively. xl: only — collapses to
          // stacked below 1280px.
          "w-[440px] shrink-0 sticky top-20 self-start hidden xl:block"
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
  const [active, setActive] = useState(panels[0].key);
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
