// Admin add/edit dialog for a collateral asset. Tag pickers offer the
// values already in use (checkboxes) plus a free-text add, so the
// taxonomy grows from data without a deploy — same principle as the
// chips (Jordan item 3's note).

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSaveCollateralItem, type CollateralItem } from "./api";

function MultiValueField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const all = [...new Set([...options, ...selected])].sort((a, b) =>
    a.localeCompare(b),
  );

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!selected.includes(value)) onChange([...selected, value]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {all.length > 0 && (
        <div className="grid max-h-32 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-md border p-2.5">
          {all.map((value) => (
            <label key={value} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(value)}
                onCheckedChange={(c) =>
                  onChange(
                    c ? [...selected, value] : selected.filter((v) => v !== value),
                  )
                }
              />
              <span className="truncate">{value}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add a ${label.toLowerCase()} value`}
          className="h-8 text-sm"
        />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function CollateralItemDialog({
  open,
  onOpenChange,
  item,
  knownAssetTypes,
  knownProducts,
  knownSegments,
  knownUses,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = create a new asset. */
  item: CollateralItem | null;
  knownAssetTypes: string[];
  knownProducts: string[];
  knownSegments: string[];
  knownUses: string[];
}) {
  const save = useSaveCollateralItem();
  const [title, setTitle] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [assetType, setAssetType] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [uses, setUses] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setWebUrl(item?.web_url ?? "");
    setAssetType(item?.asset_type ?? "");
    setProducts(item?.products ?? []);
    setSegments(item?.segments ?? []);
    setUses(item?.uses ?? ["Send to Prospect"]);
    setPinned(item?.pinned ?? false);
  }, [open, item]);

  function submit() {
    if (!title.trim()) {
      toast.error("Give the asset a title.");
      return;
    }
    if (!/^https?:\/\//i.test(webUrl.trim())) {
      toast.error("The link must be a full URL (https://...).");
      return;
    }
    save.mutate(
      {
        id: item?.id,
        title: title.trim(),
        web_url: webUrl.trim(),
        asset_type: assetType.trim() || null,
        products,
        segments,
        uses,
        pinned,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{item ? "Edit asset" : "Add asset"}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="col-title">Title</Label>
            <Input
              id="col-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. HIPAA Training Brochure"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="col-url">SharePoint link</Label>
            <Input
              id="col-url"
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="https://medcurityinc.sharepoint.com/..."
            />
            <p className="text-xs text-muted-foreground">
              Use the file's Share link so it keeps working if the file is
              renamed or moved.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="col-type">Asset type</Label>
            <Input
              id="col-type"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              placeholder={knownAssetTypes.length ? knownAssetTypes.join(" · ") : "e.g. One-Pager, Case Study, Battlecard"}
              list="collateral-asset-types"
            />
            <datalist id="collateral-asset-types">
              {knownAssetTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <MultiValueField label="Products" options={knownProducts} selected={products} onChange={setProducts} />
          <MultiValueField label="Segments" options={knownSegments} selected={segments} onChange={setSegments} />
          <MultiValueField label="Use" options={knownUses.length ? knownUses : ["Send to Prospect", "Internal Enablement"]} selected={uses} onChange={setUses} />
          <div className="flex items-center gap-2 pt-1">
            <Switch id="col-pinned" checked={pinned} onCheckedChange={setPinned} />
            <Label htmlFor="col-pinned">Pin to the top row</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving..." : item ? "Save changes" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
