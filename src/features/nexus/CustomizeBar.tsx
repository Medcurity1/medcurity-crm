// The Customize-mode banner. Shows only while Customize is on, sits under
// the hero it restyles, and says in one line what you can do from here.
//
// Everything on this page that a person can personalize is reachable in
// this mode: drag to rearrange, X to remove, the pin to promote a widget
// above the divider, the Add tile for the gallery, and these four swatches
// for the hero look. The Done button lives on the "Your widgets" divider,
// where the Customize button was.

import { Pin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HERO_THEMES, type HeroThemeId } from "./hero-themes";
import { MAX_FEATURED } from "./featured";

export interface CustomizeBarProps {
  heroTheme: HeroThemeId;
  onHeroThemeChange: (id: HeroThemeId) => void;
  /** How many widgets are pinned right now. */
  featuredCount: number;
}

export function CustomizeBar({
  heroTheme,
  onHeroThemeChange,
  featuredCount,
}: CustomizeBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Customizing your page
        </p>
        <p className="text-xs text-muted-foreground">
          Drag a widget to move it. Use the X to remove one, the pin to send
          it to the top, and Add to bring in a new one.
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Pin className="h-3 w-3" />
          {featuredCount} of {MAX_FEATURED} pinned to the top
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Hero look</span>
        <div className="flex items-center gap-1.5">
          {HERO_THEMES.map((theme) => {
            const selected = theme.id === heroTheme;
            return (
              <Tooltip key={theme.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onHeroThemeChange(theme.id)}
                    aria-label={`${theme.label} hero look`}
                    aria-pressed={selected}
                    className={cn(
                      "h-7 w-7 overflow-hidden rounded-full border border-border/60",
                      selected &&
                        "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                  >
                    {/* Same two-layer trick as the hero: the swatch shows
                        the version of the preset you would actually get. */}
                    <span
                      aria-hidden
                      className="block h-full w-full dark:hidden"
                      style={{ backgroundImage: theme.light }}
                    />
                    <span
                      aria-hidden
                      className="hidden h-full w-full dark:block"
                      style={{ backgroundImage: theme.dark }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{theme.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
