import { useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Bot,
  CheckCheck,
  CheckSquare,
  Calendar,
  TrendingUp,
  AtSign,
  Mail,
  Info,
  Trash2,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatRelativeDate } from "@/lib/formatters";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
  useClearAllNotifications,
} from "@/features/notifications/notifications-api";
import type { Notification } from "@/types/crm";

const typeIcon: Record<Notification["type"], ComponentType<{ className?: string }>> = {
  task_due: CheckSquare,
  renewal_upcoming: Calendar,
  deal_stage_change: TrendingUp,
  mention: AtSign,
  engagement: Mail,
  system: Info,
  meddy_new_chat: Bot,
  meddy_human_requested: Bot,
  meddy_buying_intent: Bot,
  meddy_missed_chat: Bot,
  meddy_contact_received: Bot,
};

const typeColor: Record<Notification["type"], string> = {
  task_due: "text-amber-600 dark:text-amber-400",
  renewal_upcoming: "text-blue-600 dark:text-blue-400",
  deal_stage_change: "text-green-600 dark:text-green-400",
  mention: "text-purple-600 dark:text-purple-400",
  engagement: "text-indigo-600 dark:text-indigo-400",
  system: "text-muted-foreground",
  // Meddy dot colors carried over from Nexus (NOTIF_TYPE_COLORS).
  meddy_new_chat: "text-sky-600 dark:text-sky-400",
  meddy_human_requested: "text-red-600 dark:text-red-400",
  meddy_buying_intent: "text-amber-500 dark:text-amber-400",
  meddy_missed_chat: "text-red-500 dark:text-red-400",
  meddy_contact_received: "text-green-600 dark:text-green-400",
};

export function NotificationsDropdown() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications(30);
  const { data: unreadCount = 0 } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();
  const clearAll = useClearAllNotifications();
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClick = (n: Notification) => {
    if (!n.is_read) {
      markAsRead.mutate(n.id);
    }
    if (n.link) {
      navigate(n.link);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* Solid, opaque surface — readability beats see-through cool. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] border-border bg-popover p-0 shadow-xl"
      >
        <div className="flex items-center justify-between gap-1 border-b border-border bg-muted/40 px-4 py-2">
          <div className="text-sm font-semibold">Notifications</div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending}
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground"
                onClick={() => setConfirmClear(true)}
                disabled={clearAll.isPending}
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              No notifications yet
            </p>
          </div>
        ) : (
          // Plain overflow container: caps the dropdown height and scrolls
          // inside the box (the old ScrollArea never actually constrained
          // its viewport, so long lists ran off the screen).
          <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain">
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const Icon = typeIcon[n.type] ?? Info;
                return (
                  <li
                    key={n.id}
                    className={`group relative flex gap-3 px-4 py-3 transition-colors hover:bg-accent ${
                      !n.is_read ? "bg-accent/40" : ""
                    } ${n.link ? "cursor-pointer" : ""}`}
                    onClick={() => handleClick(n)}
                  >
                    <div className="flex-shrink-0 pt-0.5">
                      <Icon className={`h-4 w-4 ${typeColor[n.type] ?? "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm ${!n.is_read ? "font-semibold" : "font-medium"}`}>
                          {n.title}
                        </p>
                        {!n.is_read && (
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                        )}
                      </div>
                      {n.message && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatRelativeDate(n.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete notification"
                      className="absolute right-2 top-2 rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification.mutate(n.id);
                      }}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PopoverContent>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear All Notifications"
        description="This removes your whole notification history. New notifications will keep arriving as usual."
        confirmLabel="Clear all"
        destructive
        onConfirm={() => {
          clearAll.mutate();
          setConfirmClear(false);
        }}
      />
    </Popover>
  );
}
