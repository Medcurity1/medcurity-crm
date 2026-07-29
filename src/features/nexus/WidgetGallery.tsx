// The widget gallery: the visual half of "add a widget".
//
// The old flow opened a settings sheet whose first control was a list of
// type names, which asked people to know what "Custom Report" looks like
// before they had ever seen one. The gallery shows each type as a small
// static mock (widget-previews.tsx) with its name and one line about what
// it does. Pick one and the existing settings step opens on that type, so
// there is exactly one place per type where configuration is written.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NEXUS_WIDGET_TYPES, type NexusWidgetType } from "./types";
import { TYPE_META } from "./WidgetBuilder";
import { WidgetPreview } from "./widget-previews";

export interface WidgetGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chosen type, handed to the settings step. */
  onPick: (type: NexusWidgetType) => void;
}

export function WidgetGallery({ open, onOpenChange, onPick }: WidgetGalleryProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>
            Pick one to set it up. You can rename, recolor, and move it after.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NEXUS_WIDGET_TYPES.map((type) => {
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <WidgetPreview type={type} />
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{meta.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {meta.galleryBlurb}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
