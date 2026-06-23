// Playbook types — mirror the playbook_* tables (20260624000001).

export type PlaybookActionType = "campaign" | "content" | "strategy" | "outreach";
export type PlaybookEffort = "quick" | "medium" | "big";
export type PlaybookIdeaStatus = "new" | "good" | "bad" | "booked" | "executed";
export type PlaybookCampaignStatus = "planned" | "in_progress" | "complete";
export type PlaybookPlatform = "smartlead" | "mailchimp";
export type AdaptationStatus = "pending" | "applied" | "dismissed";

export interface PlaybookIdea {
  id: string;
  week_date: string;
  title: string;
  description: string | null;
  reasoning: string | null;
  action_type: PlaybookActionType;
  effort: PlaybookEffort;
  status: PlaybookIdeaStatus;
  feedback_note: string | null;
  campaign_prefill: Record<string, unknown> | null;
  executed_campaign_id: string | null;
  created_at: string;
}

export interface CampaignMetrics {
  sent?: number;
  openRate?: number;
  clickRate?: number;
  replies?: number;
  bounces?: number;
  [k: string]: unknown;
}

export interface WorkflowStep {
  type: "email" | "call";
  label: string;
  status: "pending" | "done";
}

export interface PlaybookCampaign {
  id: string;
  title: string;
  platform: PlaybookPlatform;
  status: PlaybookCampaignStatus;
  smartlead_campaign_id: number | null;
  mailchimp_campaign_id: string | null;
  notes: string | null;
  metrics: CampaignMetrics | null;
  analyzed_at: string | null;
  analysis_json: Record<string, unknown> | null;
  adaptive_enabled: boolean;
  adaptation_history: unknown | null;
  workflow_steps: WorkflowStep[] | null;
  current_step: number;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaybookTrainingNote {
  id: string;
  note: string;
  source: string;
  related_idea_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CampaignAdaptation {
  id: string;
  campaign_id: string;
  seq_number: number | null;
  original_subject: string | null;
  original_body: string | null;
  adapted_subject: string | null;
  adapted_body: string | null;
  reason: string | null;
  status: AdaptationStatus;
  metrics_at_time: CampaignMetrics | null;
  created_at: string;
}
