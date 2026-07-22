// Playbook types — mirror the playbook_* tables (20260624000001) plus the
// unified campaigns table (20260625000001 + 20260722100000_campaigns_unify).

// ── Campaigns sequence builder (20260625000001) ─────────────────────────────
export type SequenceChannel = "EMAIL_AUTO" | "EMAIL_HYBRID" | "CALL" | "LINKEDIN";
export type SequenceAutomation = "AUTO" | "HYBRID" | "MANUAL";

export interface SequenceStep {
  order: number;
  day_offset: number;
  channel: SequenceChannel;
  weekday_target?: string;
  send_window_start?: string;
  send_window_end?: string;
  automation: SequenceAutomation;
  subject_template?: string;
  body_template?: string;
  content_ai_draft?: boolean;
  manual_task_title_template?: string;
  manual_task_priority?: string;
  task_note_template?: string;
  pause_on_reply?: boolean;
  stop_on_unsubscribe?: boolean;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string | null;
  category: "flagship" | "warming" | "post_demo" | "re_engagement" | "event" | "custom";
  is_preset: boolean;
  owner_user_id: string | null;
  duration_days: number | null;
  step_count: number | null;
  steps: SequenceStep[];
  domain_rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type PlaybookActionType = "campaign" | "content" | "strategy" | "outreach";
export type PlaybookEffort = "quick" | "medium" | "big";
export type PlaybookIdeaStatus = "new" | "good" | "bad" | "booked" | "executed";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "stopped";
export type CampaignOrigin = "pulse" | "smartlead_import" | "legacy";
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

// campaigns — the unified table (20260625000001 + 20260722100000). Replaces
// the retired playbook_campaigns/PlaybookCampaign (now
// playbook_campaigns_archived_20260722). legacy_meta carries the fields
// that had no home here (platform, mailchimp_campaign_id,
// adaptation_history, workflow_steps, current_step) for legacy-origin rows
// only — nothing in the app reads it.
export interface Campaign {
  id: string;
  name: string;
  template_id: string | null;
  steps: SequenceStep[];
  owner_user_id: string | null;
  sending_email_account_id: string | null;
  smartlead_campaign_id: number | null;
  status: CampaignStatus;
  leads_per_day: number;
  anchor_date: string | null;
  settings: Record<string, unknown>;
  metrics: CampaignMetrics | null;
  analyzed_at: string | null;
  analysis_json: Record<string, unknown> | null;
  adaptive_enabled: boolean;
  notes: string | null;
  origin: CampaignOrigin;
  legacy_meta: Record<string, unknown> | null;
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

export type NewsletterType = "report" | "partner" | "unclassified";
export type NewsletterStatus = "draft" | "mailchimp_draft" | "sent";

export interface Newsletter {
  id: string;
  mailchimp_campaign_id: string | null;
  newsletter_type: NewsletterType;
  subject: string | null;
  preview_text: string | null;
  from_name: string | null;
  send_time: string | null;
  status: NewsletterStatus;
  html_content?: string | null;
  metrics: Record<string, string> | null;
  source: string;
  updated_at: string;
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
