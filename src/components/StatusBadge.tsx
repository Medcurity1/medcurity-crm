import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  OpportunityStage,
  AccountLifecycle,
  AccountStatus,
  OpportunityKind,
  LeadStatus,
  LeadSource,
} from "@/types/crm";

const stageColors: Record<OpportunityStage, string> = {
  lead: "bg-slate-100 text-slate-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-purple-100 text-purple-700",
  verbal_commit: "bg-amber-100 text-amber-700",
  closed_won: "bg-emerald-100 text-emerald-700",
  closed_lost: "bg-red-100 text-red-700",
};

const lifecycleColors: Record<AccountLifecycle, string> = {
  prospect: "bg-blue-100 text-blue-700",
  customer: "bg-emerald-100 text-emerald-700",
  former_customer: "bg-slate-100 text-slate-700",
};

const statusColors: Record<AccountStatus, string> = {
  discovery: "bg-blue-100 text-blue-700",
  pending: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  inactive: "bg-slate-100 text-slate-700",
  churned: "bg-red-100 text-red-700",
};

const kindColors: Record<OpportunityKind, string> = {
  new_business: "bg-violet-100 text-violet-700",
  renewal: "bg-teal-100 text-teal-700",
};

const leadStatusColors: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  qualified: "bg-emerald-100 text-emerald-700",
  unqualified: "bg-slate-100 text-slate-700",
  converted: "bg-purple-100 text-purple-700",
};

const leadSourceColors: Record<LeadSource, string> = {
  website: "bg-blue-100 text-blue-700",
  referral: "bg-emerald-100 text-emerald-700",
  cold_call: "bg-amber-100 text-amber-700",
  trade_show: "bg-violet-100 text-violet-700",
  partner: "bg-teal-100 text-teal-700",
  social_media: "bg-pink-100 text-pink-700",
  email_campaign: "bg-indigo-100 text-indigo-700",
  other: "bg-slate-100 text-slate-700",
};

type BadgeVariant = "stage" | "lifecycle" | "kind" | "status" | "leadStatus" | "leadSource";

interface StatusBadgeProps {
  value: string;
  variant: BadgeVariant;
  label: string;
}

export function StatusBadge({ value, variant, label }: StatusBadgeProps) {
  let colorClass = "";
  if (variant === "stage") colorClass = stageColors[value as OpportunityStage] ?? "";
  if (variant === "lifecycle") colorClass = lifecycleColors[value as AccountLifecycle] ?? "";
  if (variant === "status") colorClass = statusColors[value as AccountStatus] ?? "";
  if (variant === "kind") colorClass = kindColors[value as OpportunityKind] ?? "";
  if (variant === "leadStatus") colorClass = leadStatusColors[value as LeadStatus] ?? "";
  if (variant === "leadSource") colorClass = leadSourceColors[value as LeadSource] ?? "";

  return (
    <Badge variant="secondary" className={cn("font-medium", colorClass)}>
      {label}
    </Badge>
  );
}
