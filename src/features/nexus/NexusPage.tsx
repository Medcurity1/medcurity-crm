// Nexus — the customizable widget dashboard (jordan-v4-spec §2-§4).
// Lives at /nexus while it's being tested (the classic dashboard stays
// at "/" — Nathan, 2026-07-03). Each rep gets a 2-column grid of up to
// 8 widgets they can add, rename, reorder, and configure. First-time
// visitors are seeded from the system default layout via
// nexus_initialize (idempotent, once per session).
//
// Customize mode (docket C2 round 4) is the single door to all of that.
// One button, where "Add a Widget" used to be: press it and the widgets
// pick up their controls, an Add tile appears, pins and the hero look
// become editable. Press Done and the page goes back to being a page.
// The mental model is the phone home screen, not a settings panel.

import { useMemo, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { useNexusInitialize, useNexusWidgets, usePinWidget } from "./api";
import { type NexusWidget, type NexusWidgetType } from "./types";
import { selectFeatured } from "./featured";
import { useHeroTheme } from "./hero-themes";
import { NexusGrid } from "./NexusGrid";
import { FeaturedWidgets } from "./FeaturedWidgets";
import { CustomizeBar } from "./CustomizeBar";
import { useHomeLayoutImport } from "./home-import";
import { WidgetBuilder } from "./WidgetBuilder";
import { WidgetGallery } from "./WidgetGallery";
import { Briefing } from "./Briefing";
import { NexusTour } from "./NexusTour";
import { useDayQueue } from "./day-queue-api";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function NexusPage() {
  const { profile, user } = useAuth();

  // Seed first-time users from the system default layout (server-side
  // idempotent; cached for the session so it effectively runs once).
  useNexusInitialize();

  const { data: widgets } = useNexusWidgets();
  // Home layout carry-over (dormant until the landing flip; see home-import.ts).
  useHomeLayoutImport(widgets);

  const [customizing, setCustomizing] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<NexusWidget | null>(null);
  const [newType, setNewType] = useState<NexusWidgetType | null>(null);

  const [heroTheme, setHeroTheme] = useHeroTheme(user?.id);
  const pinWidget = usePinWidget();

  // The briefing owns the greeting when it can load (same react-query
  // cache, so this costs no extra round trip). If the queue read fails
  // the briefing renders nothing and this page falls back to the header
  // it has always had.
  const { isError: briefingFailed } = useDayQueue();

  const featured = useMemo(() => selectFeatured(widgets), [widgets]);
  const nextPosition = widgets?.length
    ? Math.max(...widgets.map((w) => w.position)) + 1
    : 0;

  function openEditor(widget: NexusWidget) {
    setNewType(null);
    setEditing(widget);
    setBuilderOpen(true);
  }

  /** Gallery pick lands on the settings step for that type. */
  function handleGalleryPick(type: NexusWidgetType) {
    setGalleryOpen(false);
    setEditing(null);
    setNewType(type);
    setBuilderOpen(true);
  }

  /**
   * Pin or unpin. Pinning a third widget is allowed: the pin that has been
   * up the longest steps down, and we say which one so nothing vanishes
   * without a word (the rule itself lives in featured.ts / api.ts).
   */
  function handleToggleFeatured(widget: NexusWidget) {
    const next = !widget.featured;
    pinWidget.mutate(
      { id: widget.id, featured: next },
      {
        onSuccess: (result) => {
          if (!next) {
            toast.success("Unpinned from the top");
          } else if (result.unpinnedName) {
            toast.success(
              `Pinned to the top. ${result.unpinnedName} moved back down.`,
            );
          } else {
            toast.success("Pinned to the top");
          }
        },
      },
    );
  }

  // data-tour anchors the third tour step (NexusTour.tsx). It stays on
  // this button because this button is now the whole personalization
  // story, and the tour step points at it.
  const customizeControl = (
    <Button
      data-tour="add-widget"
      variant={customizing ? "default" : "outline"}
      onClick={() => setCustomizing((c) => !c)}
    >
      {customizing ? (
        <>
          <Check className="h-4 w-4 mr-2" />
          Done
        </>
      ) : (
        <>
          <Settings2 className="h-4 w-4 mr-2" />
          Customize
        </>
      )}
    </Button>
  );

  const customizeBar = customizing ? (
    <CustomizeBar
      heroTheme={heroTheme}
      onHeroThemeChange={setHeroTheme}
      featuredCount={featured.length}
    />
  ) : null;

  const featuredStrip = (
    <FeaturedWidgets
      widgets={widgets}
      onEditWidget={openEditor}
      onToggleFeatured={handleToggleFeatured}
      editable={customizing}
      customizing={customizing}
      pinPending={pinWidget.isPending}
    />
  );

  return (
    <div className="space-y-6">
      {briefingFailed && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {getGreeting()}, {profile?.full_name ?? "there"}
              </h1>
              <p className="text-muted-foreground mt-1">
                Your day at a glance. Arrange it however you work.
              </p>
            </div>
            {customizeControl}
          </div>
          {customizeBar}
          {featuredStrip}
        </>
      )}

      {/* The anchor above the grid. Renders nothing if the queue read
          fails, in which case the header above takes over. */}
      <Briefing
        dividerActions={briefingFailed ? undefined : customizeControl}
        customizeSlot={briefingFailed ? undefined : customizeBar}
        featuredSlot={briefingFailed ? undefined : featuredStrip}
      />

      <NexusGrid
        onEditWidget={openEditor}
        editable={customizing}
        customizing={customizing}
        excludeFeatured
        onAddWidget={() => setGalleryOpen(true)}
        onToggleFeatured={handleToggleFeatured}
        pinPending={pinWidget.isPending}
      />

      <WidgetGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onPick={handleGalleryPick}
      />

      <WidgetBuilder
        open={builderOpen}
        onOpenChange={(o) => {
          setBuilderOpen(o);
          if (!o) {
            setEditing(null);
            setNewType(null);
          }
        }}
        widget={editing}
        initialType={newType}
        showTypePicker={!newType}
        onChangeType={() => {
          setBuilderOpen(false);
          setNewType(null);
          setGalleryOpen(true);
        }}
        nextPosition={nextPosition}
      />

      {/* First-visit tour. Renders null (before any hook runs) until
          NEXUS_IS_LANDING flips on swap day. See landing-flip.ts. */}
      <NexusTour />
    </div>
  );
}
