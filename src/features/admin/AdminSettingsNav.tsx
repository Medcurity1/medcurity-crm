import {
  type LucideIcon,
  Database,
  Users,
  ShieldCheck,
  Blocks,
  Zap,
  Inbox,
  Upload,
  Bot,
  Sparkles,
  Wand2,
  ScrollText,
  HeartPulse,
  Eraser,
  Server,
  Table2,
  LayoutPanelLeft,
  TextCursorInput,
  ListChecks,
  Asterisk,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grouped settings navigation. Desktop (lg+) renders a sticky left rail with
 * labeled groups — the standard settings pattern — and Object Manager's
 * sub-pages nest inline beneath it when active. Below lg it degrades to a
 * horizontally scrollable pill bar so nothing ever wraps or clips.
 *
 * Nav values are the SAME ?tab= / ?sub= strings AdminSettings has always
 * used, so deep links (watchdog notifications, audit-log links, legacy
 * redirects) are untouched.
 */

interface NavItem {
  value: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const OBJECT_MANAGER_SUB_ITEMS: NavItem[] = [
  { value: "schema", label: "Schema", icon: Table2 },
  { value: "layouts", label: "Page Layouts", icon: LayoutPanelLeft },
  { value: "custom-fields", label: "Custom Fields", icon: TextCursorInput },
  { value: "picklists", label: "Picklists", icon: ListChecks },
  { value: "required-fields", label: "Required Fields", icon: Asterisk },
];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Data model",
    items: [{ value: "object-manager", label: "Object Manager", icon: Database }],
  },
  {
    label: "People & access",
    items: [
      { value: "users", label: "Users", icon: Users },
      { value: "permissions", label: "Permissions", icon: ShieldCheck },
    ],
  },
  {
    label: "Workflow",
    items: [
      { value: "integrations", label: "Integrations", icon: Blocks },
      { value: "automations", label: "Automations", icon: Zap },
      { value: "requests", label: "Requests", icon: Inbox },
      { value: "data-import", label: "Data Import", icon: Upload },
    ],
  },
  {
    label: "AI",
    items: [
      { value: "meddy", label: "Meddy", icon: Bot },
      { value: "nexus", label: "Nexus", icon: Sparkles },
      { value: "ai-assistant", label: "AI Assistant", icon: Wand2 },
    ],
  },
  {
    label: "System & data",
    items: [
      { value: "audit-log", label: "Audit Log", icon: ScrollText },
      { value: "data-health", label: "Data Health", icon: HeartPulse },
      { value: "data-cleanup", label: "Data Cleanup", icon: Eraser },
      { value: "system", label: "System", icon: Server },
    ],
  },
];

interface AdminSettingsNavProps {
  activeTab: string;
  activeSubTab: string;
  onSelectTab: (tab: string) => void;
  onSelectSubTab: (sub: string) => void;
}

export function AdminSettingsNav({
  activeTab,
  activeSubTab,
  onSelectTab,
  onSelectSubTab,
}: AdminSettingsNavProps) {
  return (
    <>
      {/* ---- Desktop: sticky grouped rail ---- */}
      <nav
        aria-label="Settings sections"
        className="hidden lg:block w-60 shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-1"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = activeTab === item.value;
                return (
                  <div key={item.value}>
                    <button
                      type="button"
                      onClick={() => onSelectTab(item.value)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>

                    {/* Object Manager sub-pages nest inline while active */}
                    {item.value === "object-manager" &&
                      active && (
                        <div className="ml-[21px] mt-1 space-y-0.5 border-l border-border pl-2.5">
                          {OBJECT_MANAGER_SUB_ITEMS.map((sub) => {
                            const subActive = activeSubTab === sub.value;
                            return (
                              <button
                                key={sub.value}
                                type="button"
                                onClick={() => onSelectSubTab(sub.value)}
                                aria-current={subActive ? "page" : undefined}
                                className={cn(
                                  "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-left transition-colors",
                                  subActive
                                    ? "bg-primary/10 text-primary font-medium"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                              >
                                <sub.icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{sub.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ---- Mobile / narrow: horizontally scrollable pill bar ---- */}
      <nav
        aria-label="Settings sections"
        className="lg:hidden w-full space-y-1.5"
      >
        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-1 min-w-max">
            {NAV_GROUPS.flatMap((g) => g.items).map((item) => {
              const active = activeTab === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onSelectTab(item.value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                    active
                      ? "border-primary/30 bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "object-manager" && (
          <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-1 min-w-max">
              {OBJECT_MANAGER_SUB_ITEMS.map((sub) => {
                const subActive = activeSubTab === sub.value;
                return (
                  <button
                    key={sub.value}
                    type="button"
                    onClick={() => onSelectSubTab(sub.value)}
                    aria-current={subActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                      subActive
                        ? "border-primary/30 bg-primary/10 text-primary font-medium"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <sub.icon className="h-3 w-3 shrink-0" />
                    {sub.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
