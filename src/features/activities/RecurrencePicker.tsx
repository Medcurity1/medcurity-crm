// "Repeats" control for task forms (V2-A3). Pure presentational: owns no
// state, drives a RecurrenceUI value. Weekday / day-of-month aren't asked
// for here — they're derived from the task's due date at save time (see
// recurrence.ts), so the control stays to a single dropdown (+ an interval
// for "every N days", + an optional end date).

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { RecurrenceMode, RecurrenceUI } from "./recurrence";

export function RecurrencePicker({
  value,
  onChange,
}: {
  value: RecurrenceUI;
  onChange: (next: RecurrenceUI) => void;
}) {
  return (
    <div className="space-y-2 border rounded-md p-3">
      <Label className="text-sm font-semibold">Repeats</Label>
      <select
        className="w-full border rounded-md h-9 px-2 bg-background text-sm"
        value={value.mode}
        onChange={(e) =>
          onChange({ ...value, mode: e.target.value as RecurrenceMode })
        }
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="everyNDays">Every N days</option>
        <option value="weekly">Weekly (on the due weekday)</option>
        <option value="monthly">Monthly (on the due date)</option>
      </select>

      {value.mode === "everyNDays" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Every</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={value.interval}
            onChange={(e) =>
              onChange({ ...value, interval: Number(e.target.value) || 1 })
            }
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      )}

      {value.mode !== "none" && (
        <>
          <Label htmlFor="recur-until" className="text-xs text-muted-foreground">
            Stop repeating after (optional)
          </Label>
          <Input
            id="recur-until"
            type="date"
            value={value.until}
            onChange={(e) => onChange({ ...value, until: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            A new task is created automatically when you complete this one.
          </p>
        </>
      )}
    </div>
  );
}
