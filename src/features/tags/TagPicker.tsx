// Popover to pick an existing tag or create a new one inline. Used to add
// a tag on the contact detail page and to bulk-apply a tag from the list.

import { useState, type ReactNode } from "react";
import { Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useTags, useCreateTag } from "./api";
import { tagDotClass } from "./TagChips";
import type { Tag } from "@/types/crm";

export function TagPicker({
  appliedTagIds = [],
  onPick,
  trigger,
  align = "start",
}: {
  /** Tags already on the record — shown with a check, still pickable. */
  appliedTagIds?: string[];
  onPick: (tag: Tag) => void;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();

  const q = query.trim();
  const exactExists = tags.some((t) => t.name.toLowerCase() === q.toLowerCase());
  const applied = new Set(appliedTagIds);

  function close() {
    setOpen(false);
    setQuery("");
  }

  async function handleCreate() {
    try {
      const tag = await createTag.mutateAsync({ name: q });
      onPick(tag);
      close();
    } catch (e) {
      toast.error("Couldn't create tag: " + (e as Error).message);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            Add tag
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <Command>
          <CommandInput
            placeholder="Search or create a tag…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {q ? "No matching tags." : "Type to search or create a tag."}
            </CommandEmpty>
            {tags.length > 0 && (
              <CommandGroup heading="Tags">
                {tags.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => {
                      onPick(t);
                      close();
                    }}
                  >
                    <span className={cn("mr-2 h-2.5 w-2.5 rounded-full", tagDotClass(t.color))} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {applied.has(t.id) && (
                      <Check className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {q && !exactExists && (
              <CommandGroup heading="Create">
                <CommandItem value={`create new tag ${q}`} onSelect={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create “{q}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
