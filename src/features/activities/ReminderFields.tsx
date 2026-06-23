// Shared reminder UI for every task form. Channels first (both on by
// default), then "when". Warns clearly when nothing will notify.

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import { isRepeat, type ReminderUI, type ReminderTiming } from "./reminder";

export function ReminderFields({
  value,
  onChange,
  hasDueDate,
}: {
  value: ReminderUI;
  onChange: (r: ReminderUI) => void;
  hasDueDate: boolean;
}) {
  const willNotify = value.inApp || value.email;
  const set = (patch: Partial<ReminderUI>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-2 border rounded-md p-3">
      <Label className="text-sm font-semibold">Reminders</Label>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={value.inApp} onChange={(e) => set({ inApp: e.target.checked })} />
          In-app notification
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={value.email} onChange={(e) => set({ email: e.target.checked })} />
          Email
        </label>
      </div>

      {!willNotify ? (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          No notification selected — you won't be reminded about this task.
        </p>
      ) : (
        <>
          <Label htmlFor="reminder-when" className="text-xs text-muted-foreground pt-1 block">When</Label>
          <select
            id="reminder-when"
            className="w-full border rounded-md h-9 px-2 bg-background text-sm"
            value={value.timing}
            onChange={(e) => set({ timing: e.target.value as ReminderTiming })}
          >
            <option value="due">On the due date</option>
            <option value="custom">At a specific time</option>
            <option value="daily">Daily until due</option>
            <option value="weekdays">Weekdays (M–F) until due</option>
            <option value="weekly">Weekly until due</option>
          </select>

          {value.timing === "due" && !hasDueDate && (
            <p className="text-xs text-amber-600">
              Add a due date above to be reminded, or choose “At a specific time”.
            </p>
          )}

          {(value.timing === "custom" || isRepeat(value.timing)) && (
            <div className="space-y-1">
              <Label htmlFor="reminder-at" className="text-xs text-muted-foreground">
                {value.timing === "custom" ? "Remind me at" : "Start reminding at (optional)"}
              </Label>
              <Input
                id="reminder-at"
                type="datetime-local"
                value={value.customAt}
                onChange={(e) => set({ customAt: e.target.value })}
              />
            </div>
          )}

          {value.timing === "custom" && !value.customAt && !hasDueDate && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Pick a date and time above (or add a due date), or you won't be reminded.
            </p>
          )}

          {isRepeat(value.timing) && !hasDueDate && (
            <p className="text-xs text-amber-600">Repeating reminders need a due date (they repeat until it).</p>
          )}

          {value.email && (
            <p className="text-xs text-muted-foreground">
              Email reminders require your Outlook integration to have Mail.Send permission (admin can enable).
            </p>
          )}
        </>
      )}
    </div>
  );
}
