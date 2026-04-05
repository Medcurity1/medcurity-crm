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
import { cn } from "@/lib/utils";
import { activityLabel } from "@/lib/formatters";

type CalendarActivity = Activity & {
  owner: { id: string; full_name: string | null } | null;
};

function useMonthActivities(year: number, month: number) {
  return useQuery({
    queryKey: ["activities", "calendar", year, month],
    queryFn: async () => {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const { data, error } = await supabase
        .from("activities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CalendarActivity[];
    },
  });
}

const ACTIVITY_ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: UsersIcon,
  note: StickyNote,
  task: CheckSquare,
};

function getRecordLink(a: CalendarActivity): { to: string; label: string } | null {
  if (a.opportunity_id) {
    return { to: `/opportunities/${a.opportunity_id}`, label: "Opportunity" };
  }
  if (a.contact_id) {
    return { to: `/contacts/${a.contact_id}`, label: "Contact" };
  }
  if (a.account_id) {
    return { to: `/accounts/${a.account_id}`, label: "Account" };
  }
  return null;
}

export function ActivityCalendar() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

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
      const key = format(parseISO(a.created_at), "yyyy-MM-dd");
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [activities]);

  const selectedActivities = useMemo(() => {
    if (!selectedDate || !activities) return [];
    return activities.filter((a) =>
      isSameDay(parseISO(a.created_at), selectedDate)
    );
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
            {!selectedDate ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Click a day to see activities
              </p>
            ) : selectedActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No activities for this date
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
                                className="text-primary hover:underline"
                              >
                                {link.label}
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
