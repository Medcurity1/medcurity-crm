import type { ReactNode } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { cn } from "@/lib/utils";

/**
 * Wraps a detail page body so we can flip between two layouts based on the
 * user's `detailLayout` preference.
 *
 * Usage:
 *   <DetailPageLayout side={<ActivityTimeline accountId={id} compact />}>
 *     <Tabs ...>...</Tabs>
 *     <CollapsibleSection ...>...</CollapsibleSection>
 *   </DetailPageLayout>
 *
 * In side_panel mode the children render in a flex-grow column on the left
 * and `side` is pinned to a sticky right column. In stacked mode the side
 * content is appended below the children (so we never lose access to it).
 */
export function DetailPageLayout({
  children,
  side,
  sideTitle = "Activity",
}: {
  children: ReactNode;
  side: ReactNode;
  sideTitle?: string;
}) {
  const { prefs } = useUserPreferences();
  const useSidePanel = prefs.detailLayout === "side_panel";

  if (!useSidePanel) {
    return (
      <>
        {children}
        <div className="mt-6">{side}</div>
      </>
    );
  }

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0">{children}</div>
      <aside
        className={cn(
          // Slightly wider so email From/To addresses + thread subjects
          // don't truncate so aggressively. xl: only — collapses to stacked
          // below 1280px.
          "w-[440px] shrink-0 sticky top-20 self-start hidden xl:block"
        )}
      >
        <div className="border rounded-lg p-4 bg-card max-h-[calc(100vh-6rem)] overflow-y-auto">
          <h3 className="text-sm font-semibold mb-3">{sideTitle}</h3>
          {side}
        </div>
      </aside>
    </div>
  );
}
