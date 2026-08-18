// Shared entity visuals — one place that answers "what does an account /
// contact / deal / activity look like in a list?".
//
// The vocabulary is the Nexus icon-chip: a 6x6 rounded square with a soft
// two-stop gradient and a tinted icon, the same shape KpiCard's
// CATEGORY_ACCENTS produces for metric tiles (src/features/dashboard/KpiCard.tsx)
// and MetricsStrip renders at this exact size. Global search v2 is the first
// consumer; the module exists so the next surface that needs "a row that says
// what kind of record this is" doesn't invent a fourth palette.
//
// Deliberately NOT wired into the existing icon maps yet
// (ActivitiesListPage.ACTIVITY_ICONS, ActivityTimeline.typeIcons,
// HomePage.RECENT_ACTIVITY_ICONS all still carry their own copies). Adopting
// those is a separate pass — this file only had to be the source of truth for
// the new search palette without touching four other surfaces on the way in.
//
// Accent colors are per docs/search/global-search-v2.md §3.4. They are token-
// free on purpose: /20 -> /[0.04] gradients over the card background read the
// same in light and dark, which is why the KPI cards use them.

import {
  Building2,
  Users,
  Target,
  Phone,
  Mail,
  Calendar,
  StickyNote,
  CheckSquare,
  MonitorPlay,
  Presentation,
  Activity as ActivityIcon,
} from "lucide-react";
import type { ActivityType } from "@/types/crm";

/** The record kinds global search can return. */
export type SearchEntity = "account" | "contact" | "opportunity" | "activity";

export interface EntityVisual {
  /** Plural label — group headings and scope chips. */
  plural: string;
  /** Lucide component for the chip. Capitalized: it renders as <Icon />. */
  Icon: typeof Building2;
  /** Gradient stops for the chip background. Pair with ENTITY_CHIP_CLASS. */
  badge: string;
  /** Icon tint. */
  iconColor: string;
  /** List route — also the detail-route base (`${route}/${id}`). */
  route: string;
}

/**
 * The chip itself. Split from the per-entity gradient so every consumer gets
 * the same box and only varies the color:
 *   <span className={cn(ENTITY_CHIP_CLASS, visual.badge)}>
 *     <Icon className={cn("h-3.5 w-3.5", visual.iconColor)} />
 *   </span>
 */
export const ENTITY_CHIP_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br";

export const ENTITY_VISUALS: Record<SearchEntity, EntityVisual> = {
  account: {
    plural: "Accounts",
    Icon: Building2,
    badge: "from-blue-500/20 to-blue-500/[0.04]",
    iconColor: "text-blue-500",
    route: "/accounts",
  },
  contact: {
    plural: "Contacts",
    Icon: Users,
    badge: "from-emerald-500/20 to-emerald-500/[0.04]",
    iconColor: "text-emerald-500",
    route: "/contacts",
  },
  opportunity: {
    plural: "Deals",
    Icon: Target,
    badge: "from-violet-500/20 to-violet-500/[0.04]",
    iconColor: "text-violet-500",
    route: "/opportunities",
  },
  activity: {
    plural: "Activity",
    Icon: ActivityIcon,
    badge: "from-amber-500/20 to-amber-500/[0.04]",
    iconColor: "text-amber-500",
    route: "/activities",
  },
};

/**
 * Per-activity-type icon, so an email row reads as an envelope and a call as a
 * phone inside the shared amber chip. Mirrors the map in
 * ActivityTimeline.tsx (typeIcons) — kept in sync by eye until that file
 * adopts this module.
 */
export const ACTIVITY_TYPE_ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  note: StickyNote,
  task: CheckSquare,
  webinar: MonitorPlay,
  conference: Presentation,
};

/**
 * Icon for an activity row. Falls back to the generic activity glyph when the
 * server sends a type this build doesn't know about (a new activity_type
 * shipping DB-first must not crash the palette).
 */
export function activityIcon(type: string | null | undefined): typeof Phone {
  if (!type) return ENTITY_VISUALS.activity.Icon;
  return ACTIVITY_TYPE_ICONS[type as ActivityType] ?? ENTITY_VISUALS.activity.Icon;
}
