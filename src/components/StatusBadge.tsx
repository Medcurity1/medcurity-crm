import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  OpportunityStage,
  AccountLifecycle,
  AccountStatus,
  CustomerStatus,
  SalesStatus,
  OpportunityKind,
  OpportunityBusinessType,
  LeadStatus,
  LeadSource,
  LeadQualification,
} from "@/types/crm";

const stageColors: Record<OpportunityStage, string> = {
  // SF-matching stages (primary) — colored by pipeline progression.
  details_analysis: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  demo: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  proposal_and_price_quote: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  proposal_conversation: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  closed_won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  closed_lost: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  // Legacy values — kept so history badges still render. Reused
  // palette roughly matching the SF equivalent.
  lead: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  qualified: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  proposal: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  verbal_commit: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const lifecycleColors: Record<AccountLifecycle, string> = {
  prospect: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  customer: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  former_customer: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const statusColors: Record<AccountStatus, string> = {
  discovery: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  inactive: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  churned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const customerStatusColors: Record<CustomerStatus, string> = {
  client: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  prospect: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  former_client: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

// Sales working state: the four working sub-statuses get distinct colors;
// "inactive" (not being worked) renders grey.
const salesStatusColors: Record<SalesStatus | "inactive", string> = {
  prospecting: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  identified_outreach: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  engaged: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  nurture: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  inactive: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const kindColors: Record<OpportunityKind, string> = {
  new_business: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  renewal: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
};

const businessTypeColors: Record<OpportunityBusinessType, string> = {
  new_business: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  existing_business: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  existing_business_new_product: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  existing_business_new_service: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  opportunity: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const leadStatusColors: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  contacted: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  unqualified: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

const leadSourceColors: Record<LeadSource, string> = {
  website: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  referral: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cold_call: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  trade_show: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  partner: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  social_media: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  email_campaign: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  webinar: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  podcast: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  conference: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  sql: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  mql: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  other: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const qualificationColors: Record<LeadQualification, string> = {
  unqualified: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  mql: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  sql: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  sal: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

type BadgeVariant = "stage" | "lifecycle" | "kind" | "businessType" | "status" | "customerStatus" | "salesStatus" | "leadStatus" | "leadSource" | "qualification";

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
  if (variant === "customerStatus") colorClass = customerStatusColors[value as CustomerStatus] ?? "";
  if (variant === "salesStatus") colorClass = salesStatusColors[value as SalesStatus | "inactive"] ?? "";
  if (variant === "kind") colorClass = kindColors[value as OpportunityKind] ?? "";
  if (variant === "businessType") colorClass = businessTypeColors[value as OpportunityBusinessType] ?? "";
  if (variant === "leadStatus") colorClass = leadStatusColors[value as LeadStatus] ?? "";
  if (variant === "leadSource") colorClass = leadSourceColors[value as LeadSource] ?? "";
  if (variant === "qualification") colorClass = qualificationColors[value as LeadQualification] ?? "";

  return (
    <Badge variant="secondary" className={cn("font-medium", colorClass)}>
      {label}
    </Badge>
  );
}
