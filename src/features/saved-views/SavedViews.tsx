import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bookmark, Trash2, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  useSavedViews,
  useSaveView,
  useDeleteSavedView,
  type SavedViewEntity,
} from "./saved-views-api";

// Pagination is transient — it's not part of what makes a "view".
const EXCLUDED = new Set(["page"]);

function readParams(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (!EXCLUDED.has(k)) out[k] = v;
  }
  return out;
}

function paramsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * Saved views (#15): save the current search/filter/sort state of a list
 * under a name and recall it later. A view is just the list's URL query
 * params, so this works on any URL-state list with no per-entity wiring.
 */
export function SavedViews({ entity }: { entity: SavedViewEntity }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: views } = useSavedViews(entity);
  const saveView = useSaveView(entity);
  const deleteView = useDeleteSavedView(entity);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  const active = readParams(searchParams);
  const hasFilters = Object.keys(active).length > 0;
  const activeView = (views ?? []).find((v) => paramsMatch(v.params ?? {}, active));

  function applyView(params: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) next.set(k, v);
    setSearchParams(next, { replace: true });
  }

  function handleSave() {
    const n = name.trim();
    if (!n) return;
    saveView.mutate(
      { name: n, params: active },
      {
        onSuccess: () => {
          setSaveOpen(false);
          setName("");
        },
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Bookmark className="h-4 w-4" />
            {activeView ? activeView.name : "Views"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {(views ?? []).length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No saved views yet. Set up your filters, then save them here.
            </div>
          ) : (
            (views ?? []).map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => applyView(v.params ?? {})}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 truncate">
                  {activeView?.id === v.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span className="truncate">{v.name}</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteView.mutate(v.id);
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Delete view ${v.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasFilters}
            onSelect={(e) => {
              e.preventDefault();
              setName("");
              setSaveOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Save current view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Saves your current search, filters, and sort so you can jump back any time.
          </p>
          <Input
            autoFocus
            placeholder="View name (e.g. WA + OR prospects)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={!name.trim() || saveView.isPending}>
              {saveView.isPending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
