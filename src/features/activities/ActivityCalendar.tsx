import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Users as UsersIcon,
  StickyNote,
  CheckSquare,
  Plus,
} from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  parseISO,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityType } from "@/types/crm";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityLabel } from "@/lib/formatters";

type CalendarActivity = Activity & {
  owner: { id: string; full_name: string | null } | null;
  account: { id: string; name: string } | null;
  opportunity: { id: string; name: string } | null;
  contact: { id: string; first_name: string; last_name: string } | null;
  lead: { id: string; first_name: string; last_name: string } | null;
};

function useMonthActivities(year: number, month: number) {
  return useQuery({
    queryKey: ["activities", "calendar", year, month],
    queryFn: async () => {
      // Pull a generous window: anything whose effective_date
      // (due_at || completed_at || created_at) falls in the visible
      // month. Simpler to fetch by created_at window with margin and
      // filter client-side, since the three-way OR is awkward in
      // PostgREST.
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const margin = 31 * 24 * 60 * 60 * 1000; // 1-month cushion both sides
      const fetchStart = new Date(start.getTime() - margin).toISOString();
      const fetchEnd = new Date(end.getTime() + margin).toISOString();
      const { data, error } = await supabase
        .from("activities")
        .select(
          "*, owner:user_profiles!owner_user_id(id, full_name), account:accounts!account_id(id, name), opportunity:opportunities!opportunity_id(id, name), contact:contacts!contact_id(id, first_name, last_name), lead:leads!lead_id(id, first_name, last_name)"
        )
        .or(
          `created_at.gte.${fetchStart},due_at.gte.${fetchStart}`
        )
        .or(
          `created_at.lte.${fetchEnd},due_at.lte.${fetchEnd}`
        );
      if (error) throw error;
      return (data ?? []) as CalendarActivity[];
    },
  });
}

/**
 * Pick the date the user actually cares about for calendar placement.
 *   - Tasks + meetings: due_at (when it's scheduled to happen)
 *   - Completed items: completed_at (when it actually happened)
 *   - Everything else: created_at (when it was logged)
 */
function activityCalendarDate(a: CalendarActivity): string {
  if (a.due_at) return a.due_at;
  if (a.completed_at) return a.completed_at;
  return a.created_at;
}

const ACTIVITY_ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: UsersIcon,
  note: StickyNote,
  task: CheckSquare,
};

function getRecordLink(
  a: CalendarActivity
): { to: string; label: string; name: string } | null {
  // Priority mirrors the specificity of the scope: opp > contact >
  // account > lead. Each gets its own badge label + the record's
  // display name so the calendar shows "Opportunity · Acme Q3 SRA"
  // at a glance instead of a bare "Opportunity".
  if (a.opportunity_id && a.opportunity) {
    return {
      to: `/opportunities/${a.opportunity_id}`,
      label: "Opportunity",
      name: a.opportunity.name,
    };
  }
  if (a.contact_id && a.contact) {
    return {
      to: `/contacts/${a.contact_id}`,
      label: "Contact",
      name: `${a.contact.first_name} ${a.contact.last_name}`,
    };
  }
  if (a.account_id && a.account) {
    return {
      to: `/accounts/${a.account_id}`,
      label: "Account",
      name: a.account.name,
    };
  }
  if (a.lead_id && a.lead) {
    return {
      to: `/leads/${a.lead_id}`,
      label: "Lead",
      name: `${a.lead.first_name} ${a.lead.last_name}`,
    };
  }
  return null;
}

export function ActivityCalendar() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  // Right-pane filters so users can scan a busy day without scrolling.
  // Applies to selectedActivities below.
  const [dayQuery, setDayQuery] = useState("");
  const [dayType, setDayType] = useState<"all" | ActivityType>("all");
  const [daySort, setDaySort] = useState<"newest" | "oldest" | "subject">(
    "newest"
  );

  const { data: activities, isLoading } = useMonthActivities(
    currentMonth.getFullYear(),
    currentMonth.getMonth()
  );

  const gridDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const countsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of activities ?? []) {
      const key = format(parseISO(activityCalendarDate(a)), "yyyy-MM-dd");
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [activities]);

  const selectedActivities = useMemo(() => {
    if (!selectedDate || !activities) return [];
    const rows = activities
      .filter((a) => isSameDay(parseISO(activityCalendarDate(a)), selectedDate))
      .filter((a) => (dayType === "all" ? true : a.activity_type === dayType))
      .filter((a) => {
        if (!dayQuery) return true;
        const q = dayQuery.toLowerCase();
        return (
          a.subject.toLowerCase().includes(q) ||
          (a.body ?? "").toLowerCase().includes(q) ||
          (a.account?.name ?? "").toLowerCase().includes(q) ||
          (a.opportunity?.name ?? "").toLowerCase().includes(q) ||
          `${a.contact?.first_name ?? ""} ${a.contact?.last_name ?? ""}`
            .toLowerCase()
            .includes(q) ||
          `${a.lead?.first_name ?? ""} ${a.lead?.last_name ?? ""}`
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => {
        if (daySort === "subject") return a.subject.localeCompare(b.subject);
        const aTime = new Date(activityCalendarDate(a)).getTime();
        const bTime = new Date(activityCalendarDate(b)).getTime();
        return daySort === "oldest" ? aTime - bTime : bTime - aTime;
      });
    return rows;
  }, [activities, selectedDate]);

  function colorClass(count: number): string {
    if (count === 0) return "";
    if (count <= 2) return "bg-primary/10";
    return "bg-primary/25";
  }

  return (
    <div>
      <PageHeader
        title="Activity Calendar"
        description="View activities by date"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                setCurrentMonth(today);
                setSelectedDate(today);
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[140px] text-center text-sm font-medium">
              {format(currentMonth, "MMMM yyyy")}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            {isLoading ? (
              <Skeleton className="h-[500px] w-full" />
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div
                      key={d}
                      className="text-xs font-semibold text-muted-foreground text-center py-2"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {gridDays.map((day) => {
                    const key = format(day, "yyyy-MM-dd");
                    const count = countsByDate[key] || 0;
                    const inMonth = isSameMonth(day, currentMonth);
                    const isSelected =
                      selectedDate && isSameDay(day, selectedDate);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedDate(day)}
                        className={cn(
                          "aspect-square p-2 rounded-md border text-left transition-colors flex flex-col",
                          "hover:border-primary/50",
                          inMonth ? "border-border" : "border-transparent",
                          !inMonth && "text-muted-foreground/40",
                          isSelected && "ring-2 ring-primary border-primary",
                          colorClass(count)
                        )}
                      >
                        <span
                          className={cn(
                            "text-sm font-medium",
                            isToday && "text-primary font-bold"
                          )}
                        >
                          {format(day, "d")}
                        </span>
                        {count > 0 && (
                          <span className="mt-auto">
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 h-4"
                            >
                              {count}
                            </Badge>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">
              {selectedDate
                ? format(selectedDate, "MMM d, yyyy")
                : "Select a date"}
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/opportunities">
                <Plus className="h-4 w-4 mr-1" />
                Add Activity
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {selectedDate && (
              <div className="space-y-2 mb-3">
                <Input
                  placeholder="Search this day..."
                  value={dayQuery}
                  onChange={(e) => setDayQuery(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="flex gap-2">
                  <Select
                    value={dayType}
                    onValueChange={(v) => setDayType(v as typeof dayType)}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="call">Calls</SelectItem>
                      <SelectItem value="email">Emails</SelectItem>
                      <SelectItem value="meeting">Meetings</SelectItem>
                      <SelectItem value="note">Notes</SelectItem>
                      <SelectItem value="task">Tasks</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={daySort}
                    onValueChange={(v) => setDaySort(v as typeof daySort)}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                      <SelectItem value="subject">Subject A–Z</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {!selectedDate ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Click a day to see activities
              </p>
            ) : selectedActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No activities match your filters for this date
              </p>
            ) : (
              <ul className="space-y-3">
                {selectedActivities.map((a) => {
                  const Icon = ACTIVITY_ICONS[a.activity_type] ?? StickyNote;
                  const link = getRecordLink(a);
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-3 pb-3 border-b last:border-b-0 last:pb-0"
                    >
                      <div className="mt-0.5 h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {a.subject}
                        </p>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                          <span>{activityLabel(a.activity_type)}</span>
                          {a.owner?.full_name && (
                            <>
                              <span>&middot;</span>
                              <span className="truncate">
                                {a.owner.full_name}
                              </span>
                            </>
                          )}
                          {link && (
                            <>
                              <span>&middot;</span>
                              <Link
                                to={link.to}
                                className="text-primary hover:underline truncate max-w-[240px]"
                                title={`${link.label}: ${link.name}`}
                              >
                                {link.label}: {link.name}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
