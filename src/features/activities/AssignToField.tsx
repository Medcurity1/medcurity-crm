import { Label } from "@/components/ui/label";
import { useUsers } from "@/features/accounts/api";
import { useAuth } from "@/features/auth/AuthProvider";

interface UserRow {
  id: string;
  full_name: string | null;
  is_active?: boolean | null;
}

/**
 * "Assign to" picker shared by the three task dialogs (ActivityForm task
 * mode, QuickTaskDialog, EditTaskDialog).
 *
 * Survey T5: every task-creation path used to hardcode owner = creator,
 * so "Summer, follow up with this" could not be a CRM action. The New
 * owner gets a `task_assigned` bell from the DB trigger in
 * 20260817140000 — nothing here writes a notification, and nothing here
 * needs to, which is the whole point of doing it at the column.
 *
 * Deliberately a bare <select> (not the shadcn Select) to match the
 * contact / priority / recurrence pickers already in these dialogs.
 *
 * Inactive users are hidden UNLESS one is the current value — that way a
 * task inherited from a departed rep still renders its real owner
 * instead of a blank select that would silently reassign on save.
 */
export function AssignToField({
  id,
  value,
  onChange,
  allowUnassigned = false,
}: {
  id: string;
  /** owner_user_id, or "" for unassigned. */
  value: string;
  onChange: (next: string) => void;
  /** Only true for legacy rows that genuinely have no owner today. */
  allowUnassigned?: boolean;
}) {
  const { user } = useAuth();
  const { data: users = [] } = useUsers(true);
  // An empty value on a picker that can't be unassigned means "not seeded
  // yet" (auth resolving after mount), not "nobody" — show me rather than
  // a blank row. Every caller already coalesces "" to the current user on
  // submit, so the display and the write agree.
  const shown = value || (allowUnassigned ? "" : user?.id ?? "");
  const options = (users as UserRow[]).filter(
    (u) => u.is_active !== false || u.id === shown,
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Assign to</Label>
      <select
        id={id}
        className="w-full border rounded-md h-9 px-2 bg-background text-sm"
        value={shown}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowUnassigned && <option value="">Unassigned</option>}
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name ?? u.id}
            {u.id === user?.id ? " (me)" : ""}
            {u.is_active === false ? " (inactive)" : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {!shown || shown === user?.id
          ? "Defaults to you. Pick a teammate to hand it off."
          : "They get a notification and it lands in their task list."}
      </p>
    </div>
  );
}
