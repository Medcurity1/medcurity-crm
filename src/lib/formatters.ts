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
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  verbal_commit: "Verbal Commit",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
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

export const OPEN_STAGES: OpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "verbal_commit",
];

export const ALL_STAGES: OpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "verbal_commit",
  "closed_won",
  "closed_lost",
];
