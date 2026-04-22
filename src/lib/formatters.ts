import { format, formatDistanceToNow, parseISO, differenceInDays } from "date-fns";
import type { OpportunityStage, AccountLifecycle, AccountStatus, RenewalType, ActivityType, OpportunityKind, OpportunityTeam, LeadStatus, LeadSource, PaymentFrequency, LeadQualification } from "@/types/crm";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyDetailed(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return format(parseISO(dateString), "MMM d, yyyy");
}

export function formatDateTime(dateString: string | null): string {
  if (!dateString) return "—";
  return format(parseISO(dateString), "MMM d, yyyy h:mm a");
}

export function formatRelativeDate(dateString: string | null): string {
  if (!dateString) return "—";
  return formatDistanceToNow(parseISO(dateString), { addSuffix: true });
}

export function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null;
  return differenceInDays(parseISO(dateString), new Date());
}

export function formatName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`;
}

const stageLabels: Record<OpportunityStage, string> = {
  // SF-matching stages (current) — these are what the UI surfaces.
  details_analysis: "Details Analysis",
  demo: "Demo",
  proposal_and_price_quote: "Proposal and Price Quote",
  proposal_conversation: "Proposal Conversation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
  // Legacy labels — kept so old history rows still render a human
  // name instead of crashing. Migration 20260422000001 rewrote all
  // data to SF values, so these should be vanishingly rare.
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  verbal_commit: "Verbal Commit",
};

export function stageLabel(stage: OpportunityStage): string {
  return stageLabels[stage];
}

const lifecycleLabels: Record<AccountLifecycle, string> = {
  prospect: "Prospect",
  customer: "Customer",
  former_customer: "Former Customer",
};

export function lifecycleLabel(status: AccountLifecycle): string {
  return lifecycleLabels[status];
}

const activityLabels: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  task: "Task",
};

export function activityLabel(type: ActivityType): string {
  return activityLabels[type];
}

const kindLabels: Record<OpportunityKind, string> = {
  new_business: "New Business",
  renewal: "Renewal",
};

export function kindLabel(kind: OpportunityKind): string {
  return kindLabels[kind];
}

const teamLabels: Record<OpportunityTeam, string> = {
  sales: "Sales",
  renewals: "Renewals",
};

export function teamLabel(team: OpportunityTeam): string {
  return teamLabels[team];
}

const statusLabels: Record<AccountStatus, string> = {
  discovery: "Discovery",
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
  churned: "Churned",
};

export function statusLabel(status: AccountStatus): string {
  return statusLabels[status];
}

const renewalTypeLabels: Record<RenewalType, string> = {
  auto_renew: "Auto Renew",
  manual_renew: "Manual Renew",
  no_auto_renew: "No Auto Renew",
  full_auto_renew: "Full Auto Renew",
  platform_only_auto_renew: "Platform Only Auto Renew",
};

export function renewalTypeLabel(type: RenewalType): string {
  return renewalTypeLabels[type];
}

const leadStatusLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  unqualified: "Unqualified",
  converted: "Converted",
};

export function leadStatusLabel(status: LeadStatus): string {
  return leadStatusLabels[status];
}

const leadSourceLabels: Record<LeadSource, string> = {
  website: "Website",
  referral: "Referral",
  cold_call: "Cold Call",
  trade_show: "Trade Show",
  partner: "Partner",
  social_media: "Social Media",
  email_campaign: "Email Campaign",
  webinar: "Webinar",
  podcast: "Podcast",
  conference: "Conference",
  sql: "SQL",
  mql: "MQL",
  other: "Other",
};

export function leadSourceLabel(source: LeadSource): string {
  return leadSourceLabels[source];
}

const paymentFrequencyLabels: Record<PaymentFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annually: "Semi-Annually",
  annually: "Annually",
  one_time: "One-Time",
};

export function paymentFrequencyLabel(freq: PaymentFrequency): string {
  return paymentFrequencyLabels[freq];
}

const qualificationLabels: Record<LeadQualification, string> = {
  unqualified: "Unqualified",
  mql: "MQL",
  sql: "SQL",
  sal: "SAL",
};

export function qualificationLabel(q: LeadQualification): string {
  return qualificationLabels[q];
}

/* ---- FTE Range ---- */

export const FTE_RANGES = [
  "1-20",
  "21-50",
  "51-100",
  "101-250",
  "251-500",
  "501-750",
  "751-1000",
  "1001-1500",
  "1501-2000",
  "2001-5000",
  "5001-10000",
] as const;

/** Given a number of employees, return the matching FTE range bucket */
export function employeesToFteRange(employees: number | null | undefined): string {
  if (employees == null || employees <= 0) return "";
  if (employees <= 20) return "1-20";
  if (employees <= 50) return "21-50";
  if (employees <= 100) return "51-100";
  if (employees <= 250) return "101-250";
  if (employees <= 500) return "251-500";
  if (employees <= 750) return "501-750";
  if (employees <= 1000) return "751-1000";
  if (employees <= 1500) return "1001-1500";
  if (employees <= 2000) return "1501-2000";
  if (employees <= 5000) return "2001-5000";
  return "5001-10000";
}

export const OPEN_STAGES: OpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "verbal_commit",
];

// Stages shown in the UI + used by pipeline-view defaults. Order
// matches the SF probability ladder (low → high, then closed states).
export const ALL_STAGES: OpportunityStage[] = [
  "details_analysis",
  "demo",
  "proposal_and_price_quote",
  "proposal_conversation",
  "closed_won",
  "closed_lost",
];
