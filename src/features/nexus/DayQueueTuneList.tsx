import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DAY_QUEUE_CATEGORIES,
  canHideCategory,
  categoryDotClass,
  categoryLabel,
} from "./day-queue";
import {
  useDayQueuePrefs,
  useSetDayCategoryHidden,
  useUnhideDayItem,
} from "./day-queue-api";

export function DayQueueTuneList() {
  const prefs = useDayQueuePrefs();
  const setHidden = useSetDayCategoryHidden();
  const unhide = useUnhideDayItem();
  const hidden = new Set(prefs.data?.hiddenCategories ?? []);
  const hiddenItems = prefs.data?.hiddenItems ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 border-border/70 bg-background/70 text-foreground shadow-none backdrop-blur-sm dark:bg-background/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Tune your list
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <PopoverHeader className="border-b px-4 py-3">
          <PopoverTitle className="text-sm font-semibold">Tune your list</PopoverTitle>
          <PopoverDescription className="text-xs">
            Choose what Your Day shows.
          </PopoverDescription>
        </PopoverHeader>

        <div className="max-h-[min(24rem,70dvh)] overflow-y-auto px-2 py-2">
          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Categories
          </p>
          <ul className="space-y-0.5">
            {DAY_QUEUE_CATEGORIES.map((cat) => {
              const hideable = canHideCategory(cat.id);
              const checked = hideable ? !hidden.has(cat.id) : true;
              const switchId = `day-queue-cat-${cat.id.replace(/[:]/g, "-")}`;
              return (
                <li
                  key={cat.id}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      categoryDotClass(cat.id),
                    )}
                  />
                  <Label
                    htmlFor={switchId}
                    className="min-w-0 flex-1 font-normal"
                  >
                    <span className="block text-sm">{cat.label}</span>
                    {!hideable && (
                      <span className="block text-[11px] text-muted-foreground">
                        Always stays on
                      </span>
                    )}
                  </Label>
                  <Switch
                    id={switchId}
                    size="sm"
                    checked={checked}
                    disabled={!hideable || setHidden.isPending}
                    aria-label={
                      hideable
                        ? `Show ${cat.label.toLowerCase()} on Your Day`
                        : `${cat.label} always stay on Your Day`
                    }
                    onCheckedChange={(on) => {
                      if (!hideable) return;
                      setHidden.mutate({ category: cat.id, hidden: !on });
                    }}
                  />
                </li>
              );
            })}
          </ul>

          <div className="mx-2 my-2 border-t" />

          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Hidden reminders
          </p>
          {prefs.isError ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Couldn't load hidden reminders.
            </p>
          ) : hiddenItems.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              None hidden.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {hiddenItems.map((item) => (
                <li
                  key={item.item_key}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      categoryDotClass(item.category),
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {item.title?.trim() || "Reminder"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {categoryLabel(item.category)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="shrink-0"
                    disabled={unhide.isPending}
                    onClick={() => unhide.mutate(item.item_key)}
                  >
                    Show again
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
