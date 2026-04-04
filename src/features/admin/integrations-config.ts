import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Mail,
  Calendar,
  MessageSquare,
  Receipt,
  Zap,
  Database,
} from "lucide-react";

export type IntegrationStatus = "connected" | "available" | "coming_soon";

export type IntegrationCategory =
  | "email"
  | "calendar"
  | "documents"
  | "messaging"
  | "finance"
  | "automation"
  | "data";

export interface Integration {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  status: IntegrationStatus;
  category: IntegrationCategory;
  /** If set, the action button navigates to this admin tab instead of toggling connection */
  actionLabel?: string;
  actionTab?: string;
}

export const integrations: Integration[] = [
  {
    id: "pandadoc",
    name: "PandaDoc",
    description:
      "Sync contracts and proposals. Auto-populate contract dates and products on accounts.",
    icon: FileText,
    status: "coming_soon",
    category: "documents",
  },
  {
    id: "gmail",
    name: "Gmail",
    description:
      "Automatically log emails to and from CRM contacts. No BCC required.",
    icon: Mail,
    status: "coming_soon",
    category: "email",
  },
  {
    id: "outlook",
    name: "Outlook",
    description:
      "Automatically log emails to and from CRM contacts via Microsoft 365.",
    icon: Mail,
    status: "coming_soon",
    category: "email",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description:
      "Sync meetings and events. Auto-create activity records for scheduled meetings.",
    icon: Calendar,
    status: "coming_soon",
    category: "calendar",
  },
  {
    id: "slack",
    name: "Slack",
    description:
      "Get notifications for deal stage changes, new leads, and upcoming renewals.",
    icon: MessageSquare,
    status: "coming_soon",
    category: "messaging",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description:
      "Sync invoices and payment status. Track revenue directly in the CRM.",
    icon: Receipt,
    status: "coming_soon",
    category: "finance",
  },
  {
    id: "zapier",
    name: "Zapier",
    description:
      "Connect to 5000+ apps. Automate workflows between your CRM and other tools.",
    icon: Zap,
    status: "coming_soon",
    category: "automation",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description:
      "Import historical data from Salesforce. Map fields and migrate records.",
    icon: Database,
    status: "available",
    category: "data",
    actionLabel: "Import Data",
    actionTab: "data-import",
  },
];

export function getIntegrationsByCategory(
  category: IntegrationCategory
): Integration[] {
  return integrations.filter((i) => i.category === category);
}

export function getIntegrationById(id: string): Integration | undefined {
  return integrations.find((i) => i.id === id);
}
