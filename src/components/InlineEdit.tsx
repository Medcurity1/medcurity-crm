import { useState, useRef, useEffect } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { toast } from "sonner";

export interface InlineEditProps {
  value: string | number | null;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "number" | "currency" | "date" | "textarea";
  placeholder?: string;
  className?: string;
}

function formatDisplay(value: string | number | null, type: InlineEditProps["type"]): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (type === "currency" && typeof value === "number") return formatCurrency(value);
  if (type === "currency" && typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? formatCurrency(n) : String(value);
  }
  if (type === "date" && typeof value === "string") return formatDate(value);
  if (type === "number" && typeof value === "number") return value.toLocaleString();
  return String(value);
}

function toInputValue(value: string | number | null, type: InlineEditProps["type"]): string {
  if (value === null || value === undefined) return "";
  if (type === "date" && typeof value === "string") {
    // Convert ISO date string (could be "2024-01-15" or "2024-01-15T..." ) to yyyy-mm-dd
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    return "";
  }
  return String(value);
}

export function InlineEdit({
  value,
  onSave,
  type = "text",
  placeholder,
  className,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(toInputValue(value, type));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const savedRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(toInputValue(value, type));
    }
  }, [value, type, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ("select" in inputRef.current) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  function startEdit() {
    savedRef.current = false;
    setDraft(toInputValue(value, type));
    setEditing(true);
  }

  function cancelEdit() {
    savedRef.current = true; // prevents blur from triggering save
    setDraft(toInputValue(value, type));
    setEditing(false);
  }

  async function commitSave() {
    if (savedRef.current) return;
    savedRef.current = true;
    const original = toInputValue(value, type);
    if (draft === original) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      toast.success("Saved");
      setEditing(false);
    } catch (err) {
      toast.error("Failed to save: " + (err as Error).message);
      // revert
      setDraft(toInputValue(value, type));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      void commitSave();
    } else if (e.key === "Enter" && type === "textarea" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commitSave();
    }
  }

  function handleBlur() {
    // Delay a tick to allow click-based cancel/other handlers to fire first
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      void commitSave();
    }, 150);
  }

  if (editing) {
    const inputType =
      type === "number" || type === "currency"
        ? "number"
        : type === "date"
        ? "date"
        : "text";

    return (
      <div className={cn("relative", className)}>
        {type === "textarea" ? (
          <div className="space-y-1">
            <Textarea
              ref={(el) => {
                inputRef.current = el;
              }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder}
              disabled={saving}
              rows={6}
              className="text-sm resize-y min-h-[120px]"
            />
            <p className="text-[10px] text-muted-foreground">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Esc</kbd> to cancel ·{" "}
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">⌘ Enter</kbd> to save · click outside to save
            </p>
          </div>
        ) : (
          <Input
            ref={(el) => {
              inputRef.current = el;
            }}
            type={inputType}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={saving}
            className="h-7 text-sm"
            step={type === "currency" ? "0.01" : undefined}
          />
        )}
        {saving && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  const display = formatDisplay(value, type);
  const isEmpty = value === null || value === undefined || value === "";

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        "group relative flex gap-1 text-left w-full rounded px-1 -mx-1 py-0.5 hover:bg-muted/50 transition-colors cursor-pointer",
        type === "textarea" ? "items-start" : "items-center",
        className
      )}
    >
      <span
        className={cn(
          "text-sm font-medium",
          isEmpty && "text-muted-foreground",
          type === "textarea"
            ? "whitespace-pre-wrap break-words flex-1"
            : "truncate"
        )}
      >
        {display}
      </span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto mt-0.5" />
    </button>
  );
}
