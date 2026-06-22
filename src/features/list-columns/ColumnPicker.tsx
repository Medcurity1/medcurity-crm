// Toolbar "Columns" dropdown — checkbox per hideable column, locked columns
// shown disabled, a guard so the last visible column can't be hidden, and a
// reset. The list owns the useColumnPrefs hook and passes it in, so the same
// instance drives both this menu and the table.

import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnDescriptor } from "./columns";
import type { ColumnPrefs } from "./useColumnPrefs";

export function ColumnPicker({
  columns,
  prefs,
}: {
  columns: ColumnDescriptor[];
  prefs: ColumnPrefs;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {columns.map((c) => {
          if (c.locked) {
            return (
              <DropdownMenuCheckboxItem key={c.key} checked disabled>
                <span className="flex w-full items-center justify-between">
                  {c.label}
                  <span className="ml-2 text-xs text-muted-foreground">always</span>
                </span>
              </DropdownMenuCheckboxItem>
            );
          }
          const visible = prefs.isVisible(c.key);
          // Don't let the user hide the last remaining toggleable column.
          const lastOne = visible && prefs.visibleToggleableCount === 1;
          return (
            <DropdownMenuCheckboxItem
              key={c.key}
              checked={visible}
              disabled={lastOne}
              // Keep the menu open while toggling several columns.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => prefs.toggle(c.key)}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => prefs.reset()}>
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
