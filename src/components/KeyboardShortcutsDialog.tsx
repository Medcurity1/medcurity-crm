import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatModShortcut } from "@/lib/platform";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutEntry {
  keys: string[];
  label: string;
}

// Render the mod key per platform — ⌘ on Mac, Ctrl on Windows/Linux. Was
// hardcoded ⌘K previously which confused PC users who have to press Ctrl+K.
const generalShortcuts: ShortcutEntry[] = [
  { keys: [formatModShortcut("K")], label: "Search" },
  { keys: [formatModShortcut("N")], label: "Quick Create" },
  { keys: [formatModShortcut("/")], label: "This help" },
];

const navigationShortcuts: ShortcutEntry[] = [
  { keys: ["G", "H"], label: "Go to Home" },
  { keys: ["G", "A"], label: "Go to Accounts" },
  { keys: ["G", "L"], label: "Go to Leads" },
  { keys: ["G", "O"], label: "Go to Opportunities" },
  { keys: ["G", "P"], label: "Go to Pipeline" },
  { keys: ["G", "R"], label: "Go to Reports" },
];

function ShortcutRow({ shortcut }: { shortcut: ShortcutEntry }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{shortcut.label}</span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, i) => (
          <span key={i}>
            <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground">
              {key}
            </kbd>
            {i < shortcut.keys.length - 1 && (
              <span className="mx-0.5 text-xs text-muted-foreground">
                then
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate quickly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* General */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              General
            </h3>
            <div className="divide-y">
              {generalShortcuts.map((s) => (
                <ShortcutRow key={s.label} shortcut={s} />
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Navigation
            </h3>
            <div className="divide-y">
              {navigationShortcuts.map((s) => (
                <ShortcutRow key={s.label} shortcut={s} />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
