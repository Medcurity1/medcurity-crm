# Campaigns build-out plan (2026-06-24)

Staging only. Maps + 7-slice plan (planner synthesis was terse; maps are the source of truth).

## Maps

### data-model
ORCHESTRATOR MODEL (plan §2, migration header lines 1-13): no single tool owns a sequence. Smartlead runs EMAIL_AUTO steps; the CRM owns CALL/LINKEDIN/EMAIL_HYBRID steps as `activities` tasks in "Up Next". These are NEW tables — the old `sequences`/`sequence_enrollments` were dropped (20260613000005) and must not be resurrected.

THREE TABLES (supabase/migrations/20260625000001_campaigns_foundation.sql):

1) campaign_templates (lines 18-32) — reusable starting points for the one builder:
   - id uuid PK; name text NOT NULL; description text
   - category text NOT NULL default 'custom', CHECK in ('flagship','warming','post_demo','re_engagement','event','custom')
   - is_preset boolean default false (true = shared system preset, owner null)
   - owner_user_id uuid -> user_profiles(id) ON DELETE SET NULL
   - duration_days int; step_count int
   - steps jsonb NOT NULL default '[]' — ordered step objects (shape below)
   - domain_rules jsonb NOT NULL default '{}' — e.g. {start_anchor:'nearest_monday', call_days:['TUE','FRI'], post_sequence_tag:'Nurture', reenroll_after_days:90}
   - created_at, updated_at timestamptz

2) campaigns (lines 37-53) — a launched instance = template snapshot + Smartlead link. steps are DEEP-COPIED from the template at launch and FROZEN (Smartlead can't edit a sequence post-launch; editing clones a new campaign):
   - id uuid PK; name text NOT NULL; template_id uuid -> campaign_templates(id) ON DELETE SET NULL
   - steps jsonb NOT NULL default '[]' (the frozen copy)
   - owner_user_id uuid -> user_profiles
   - sending_email_account_id text (Smartlead inbox id, the 'send from')
   - smartlead_campaign_id bigint UNIQUE
   - status text NOT NULL default 'draft', CHECK in ('draft','active','paused','completed','stopped')
   - leads_per_day int NOT NULL default 20 (throttle — the mailbox is the real bottleneck)
   - anchor_date date
   - settings jsonb default '{}' ({pause_on_reply, exclude_dnc, ...})
   - timestamps; index idx_campaigns_owner_status on (owner_user_id, status)

3) campaign_enrollments (lines 60-81) — one row per contact in a campaign. enroll_position drives the PER-LEAD throttle math: first_send_at = anchor + floor((enroll_position-1)/leads_per_day), then reconciled against Smartlead's actual sends. EVERY step (incl. manual tasks) anchors off THIS row's first_send_at, never one global campaign date (plan §5):
   - id uuid PK
   - campaign_id uuid NOT NULL -> campaigns(id) ON DELETE CASCADE
   - contact_id uuid -> contacts(id) ON DELETE CASCADE
   - account_id uuid -> accounts(id) ON DELETE SET NULL (denorm)
   - owner_user_id uuid -> user_profiles
   - enroll_position int NOT NULL default 0
   - first_send_at timestamptz (computed, then reconciled)
   - current_step int NOT NULL default 0
   - status text NOT NULL default 'active', CHECK in ('active','paused','completed','stopped','replied','bounced')
   - paused_reason text; enrolled_at, created_at, updated_at
   - UNIQUE index uq_enrollment_campaign_contact on (campaign_id, contact_id) — no double-enroll
   - indexes on (owner_user_id,status) and (contact_id,status)

ACTIVITIES COLUMNS (lines 87-92) — link campaign-spawned tasks back to their enrollment so pending tasks can be cancelled when an enrollment pauses/stops, and so a task traces to its step:
   - campaign_enrollment_id uuid -> campaign_enrollments(id) ON DELETE SET NULL
   - campaign_step_number int
   - is_campaign_generated boolean NOT NULL default false
   - partial index idx_activities_campaign_enrollment WHERE campaign_enrollment_id IS NOT NULL

STEP OBJECT SHAPE (steps jsonb element; TS mirror in src/features/playbook/types.ts lines 4-23 as SequenceStep / SequenceChannel / SequenceAutomation):
   - order:int, day_offset:int (days from the enrollment's first_send_at)
   - channel: EMAIL_AUTO | EMAIL_HYBRID | CALL | LINKEDIN
   - automation: AUTO | HYBRID | MANUAL
   - weekday_target (MON..FRI), send_window_start/send_window_end ('10:00')
   - EMAIL fields: subject_template, body_template, content_ai_draft:bool, pause_on_reply:bool, stop_on_unsubscribe:bool
   - MANUAL/task fields: manual_task_title_template ('Call {{first_name}} @ {{company}}'), manual_task_priority ('high'|'normal'), task_note_template
Channel→runner mapping (plan §2): EMAIL_AUTO=Smartlead; EMAIL_HYBRID/CALL/LINKEDIN = an activities (CRM task) row.

SEEDED PRESETS (fixed UUIDs, ON CONFLICT DO NOTHING => idempotent):
   - 8-Touch Sales Sequence (id 11111111-0000-4000-a000-000000000001): flagship, 28 days, 8 steps. Migration ...002 then flips steps 5 (Day15) & 8 (Day26) from EMAIL_HYBRID/HYBRID to EMAIL_AUTO/AUTO per Nathan — ALL emails auto-send; only CALL (Days 8,19) and LINKEDIN (Days 12,23) are rep tasks.
   - Warming Sequence (id ...002): warming, 8 days, 3 EMAIL_AUTO steps, domain_rules {start_anchor:'none'}.

**Built vs stub:** BUILT (Phase 1 data foundation only): the three tables, the activities link columns, RLS (admin-only via is_admin() — Phase 5 is meant to open it to reps with per-rep RLS), and the two seeded presets. The TS types (SequenceStep, CampaignTemplate) in types.ts and a read-only useCampaignTemplates() hook in api.ts.

STUB / NOT YET BUILT — the entire runtime engine is absent:
- Nothing writes campaigns or campaign_enrollments rows yet. api.ts's launch path (useLaunchCampaign, useGenerateCampaign) still targets the OLD playbook_campaigns table and the playbook-smartlead 'launch' action with an ad-hoc {sequence:[{seq_number,delay_days,subject,body_html}]} shape (CampaignSequenceEmail, lines 271-368) — it does NOT use the new campaign_templates.steps shape or create enrollments.
- No orchestrator/cron that: computes enroll_position/first_send_at, launches the Smartlead EMAIL_AUTO portion, spawns CALL/LINKEDIN/EMAIL_HYBRID activities tasks, advances current_step, or reconciles first_send_at against Smartlead sends.
- No reply/booked-meeting/unsubscribe pause logic writing status='replied'/'paused' or paused_reason, and no cancellation of pending campaign-generated activities on pause/stop.
- No Stop/Edit-mid-flight wiring on the new tables; useCampaigns() still reads playbook_campaigns.
- Suppression as a SOFT Do-Not-Contact alert is NOT implemented here; the only DNC handling is fetchRecipientsByTag (api.ts lines 636-663) hard-FILTERING out do_not_contact/no_longer_employed — i.e. a hard exclude at recipient fetch, which is the opposite of the intended soft, easy-to-exclude alert.

**Gaps:** 1) TWO PARALLEL CAMPAIGN MODELS COEXIST AND DON'T TALK. The new campaigns table (the sequence builder) is distinct from the legacy playbook_campaigns table (a Smartlead-import/analytics row, types.ts PlaybookCampaign lines 77-96). useCampaigns()/useLaunchCampaign() in api.ts still operate ENTIRELY on playbook_campaigns + the old per-email shape; nothing in api.ts reads or writes the new campaigns/campaign_enrollments tables. The builder's data layer is unbuilt — wiring launch to create a campaigns snapshot + enrollments is the first real engine task.

2) STEP SHAPE MISMATCH between builder and launcher. Templates use SequenceStep (channel/automation/day_offset/templates). The Smartlead launch path uses CampaignSequenceEmail (seq_number/delay_days/subject/body_html). A translation layer (template steps -> Smartlead EMAIL_AUTO subset, with CALL/LINKEDIN/HYBRID peeled off as tasks) does not exist yet.

3) DOC/SCHEMA DRIFT NOTED IN ...002: the day_offset->weekday_target mapping in the 8-Touch seed is internally inconsistent (e.g. 'Day 8 = TUE' is actually Monday from a Monday start). weekday_target is currently decorative; the engine must decide whether to derive weekday from offset or honor weekday_target (and nudge call days to Tue/Fri). Unresolved cadence decision left to Nathan.

4) THROTTLE FIELDS ARE DECLARED BUT INERT. leads_per_day (campaigns), enroll_position/first_send_at/current_step (enrollments), anchor_date have no producer/consumer code. The per-lead anchoring invariant (every step off the enrollment's own first_send_at, plan §5) exists only as comments — risk that a future implementer anchors off campaign.anchor_date globally and reintroduces the bug the design explicitly warns against.

5) SUPPRESSION INTENT INVERTED IN CURRENT CODE. Goal = soft Do-Not-Contact ALERT, never a hard block. The only existing recipient path (fetchRecipientsByTag) hard-filters DNC out. settings.exclude_dnc on campaigns is the intended soft toggle but is unused. Whoever builds enrollment must implement the soft-alert behavior rather than copy the hard filter.

6) RLS IS ADMIN-ONLY. All three tables gate on is_admin(); the plan's Phase 5 'open to reps with their own RLS' is not started, so rep-owned campaigns/tasks would currently be invisible to reps.

7) status enums differ across the two enrollment/campaign tables and the legacy PlaybookCampaignStatus ('planned'|'in_progress'|'complete'). Don't conflate them: campaigns uses draft/active/paused/completed/stopped; enrollments adds replied/bounced.

### ui
The Campaigns tab renders two stacked sections that are today largely DISCONNECTED. (1) TEMPLATE GALLERY + TIMELINE (presentation only): CampaignsTab.tsx line 150 mounts TemplatesSection at top, then a Smartlead-driven Ongoing/Past list below. TemplatesSection.tsx fetches presets via useCampaignTemplates (api.ts:168, selects campaign_templates, presets first). Each template is a Card (lines 51-77) with category accent, icon, name, description, a SequenceMiniPreview channel-dot row, step_count and duration_days; clicking opens a preview Dialog (line 100). Preview shows header, touch/day counts, an optional Monday-start caveat (line 112), then SequenceTimeline steps={preview.steps} (line 117), a read-only vertical cadence. SequenceTimeline.tsx renders per step: channel icon/label for EMAIL_AUTO/EMAIL_HYBRID/CALL/LINKEDIN (lines 10-15), Day N plus weekday computed from day_offset assuming Monday start (lines 21-22), an optional send window, a who-does-it badge (Sends automatically / You review and send / Your task, lines 24-28), and a humanized subtitle. It is purely visual: NO inputs, NO per-step editor. (2) NEW CAMPAIGN WIZARD (the functional, email-only Playbook to Smartlead path): opened by New Campaign in CampaignsTab.tsx line 158, gated behind sl.configured. CampaignWizard.tsx is a 4-step Dialog Describe to Preview/Edit to Recipients to Launch. Step 1: description >=20 chars to useGenerateCampaign (api.ts:299) calling playbook-ai generate-campaign; Claude returns a GeneratedCampaign whose sequence is EMAIL-ONLY (seq_number, delay_days, subject, body_html). Step 2: a real per-email editor — edit name/audience, subject and body (iframe preview or raw HTML toggle, lines 247-254), per-email delay_days, add follow-up (cap MAX_EMAILS=7), delete email, single-email AI rewrite (useRegenerateEmail api.ts:315), whole-sequence regenerate with feedback chips, and AI Suggest improvements (useSuggestCampaign api.ts:307). Step 3: CampaignRecipients — working three-source picker (contact tag via fetchRecipientsByTag, CSV/.txt upload with column mapping, pasted emails), dedup and validation, 10k cap. Step 4: cadence + inbox picker (useEmailAccounts), autoStart checkbox default OFF to create a Smartlead DRAFT, then useLaunchCampaign (api.ts:340) invokes playbook-smartlead launch; Smartlead sends the emails.

**Built vs stub:** FULLY WORKING: template gallery rendering, mini-preview, and the click-to-preview Dialog with the read-only SequenceTimeline (it renders real CALL/LINKEDIN/EMAIL_HYBRID steps). The entire New Campaign wizard as an EMAIL-ONLY tool: AI generation, full per-email editor (edit/add/delete/renumber, single-email AI rewrite, whole-sequence regenerate, AI suggestions), HTML/preview toggle, 3-source recipients picker, cadence/inbox config, launch-to-Smartlead (draft or start). Also Smartlead Import, Sync-metrics, and per-campaign AI Analyze on the list. DISABLED / COMING SOON (hard-coded): Use this template button in the preview Dialog is disabled (TemplatesSection.tsx:122, footer says launching plus editing from a template is the next build) — this is THE key gap; templates cannot be launched or enrolled. The Custom sequence card is cursor-not-allowed with a Soon badge (lines 81-95) — no empty-canvas builder. Adaptive monitoring checkbox in wizard Step 4 is disabled with coming soon (CampaignWizard.tsx:367-369). NOT BUILT vs the goal: No unified builder — the rich SequenceStep model (CALL/LINKEDIN/EMAIL_HYBRID, day_offset, send windows, automation mode, pause_on_reply) exists only as read-only timeline data; the wizard editor understands only flat email steps and has no editor for non-email steps. No enrollment flow — campaign_enrollments and the activities campaign columns exist in DB (migration 20260625000001) but api.ts has ZERO enrollment references (grep confirmed none); no per-lead first_send_at anchoring, no CALL/LINKEDIN/EMAIL_HYBRID to Up Next task spawning, no reply or booked-meeting pause. No Stop or Edit on a running campaign: CampaignCard (CampaignsTab.tsx:39-132) offers only Analyze (when complete), a Smartlead link, a status badge, and Delete — and Delete is shown only for status planned (line 87).

**Gaps:** Biggest structural gap: the codebase has TWO campaign concepts that do not meet — (a) the rich mixed-channel SequenceStep/template model (CALL/LINKEDIN/EMAIL_HYBRID, day_offset, automation modes) which is DISPLAY-ONLY, and (b) the flat email-only GeneratedCampaign model the wizard actually edits and launches to Smartlead. The plan's ONE unified builder does not exist yet; the wizard must be extended to edit SequenceStep arrays (not just emails) and Use this template must seed it. Load-bearing blockers to wire up next: 1) TemplatesSection.tsx:122 — Use this template is hard-disabled; there is NO code path from a template into the wizard (CampaignWizard takes no initialSteps or sourceTemplateId prop). 2) Enrollment engine absent in the frontend API: api.ts has no campaign_enrollments reads/writes and no logic to spawn CALL/LINKEDIN/EMAIL_HYBRID steps as activities in Up Next anchored per-lead off first_send_at; DB columns (campaign_enrollment_id, campaign_step_number, is_campaign_generated on activities) are unused by this UI. 3) No Stop/Edit on running campaigns — only Analyze and planned-only Delete exist on CampaignCard; mid-flight Stop/Edit must be built from scratch. 4) Reply/booked-meeting to pause is not implemented anywhere in this UI layer (pause_on_reply on the type is never consumed). 5) Suppression mismatch: the goal wants a SOFT, overridable Do-Not-Contact ALERT (never a hard block), but the only current behavior is a silent exclusion in the tag-based recipient query (CampaignRecipients.tsx:104), closer to enforced filtering than an alert; reconcile when enrollment is built. 6) SequenceTimeline weekday labels assume a Monday start and are recomputed from day_offset (lines 17-22), overriding stored weekday_target — fine for preview, but real per-lead dates only resolve at launch, which never happens for templates today. Note: STAGING ONLY; the wizard depends on SMARTLEAD_API_KEY (UI hides New Campaign/Import/Sync and shows a not-configured message when absent).

### smartlead-engine
SHARED CLIENT (supabase/functions/_shared/smartlead.ts): every Smartlead call routes through smartleadFetch() (lines 38-49). Auth is a ?api_key= QUERY PARAM, not a header (line 25). Calls run through a process-global serial queue (line 9 `let queue`) with a 200ms min gap, and doFetch (21-36) does 3x exponential backoff on HTTP 429. Read helpers (51-55): fetchCampaigns/ById/Analytics/Sequences/EmailAccounts. buildSmartleadMetrics (58-84) flattens analytics to {sent, openRate, clickRate, replies, bounces} where rates are PERCENT STRINGS ("45.2%"). mapSmartleadStatus (87-93): ACTIVE/PAUSED->in_progress, STOPPED/ARCHIVED/COMPLETED->complete, else planned.

EDGE FN (supabase/functions/playbook-smartlead/index.ts): auth gate (374-380) = isServiceRole (cron, bearer==service-role key) OR callerIsAdmin (is_admin RPC). Actions: status, email-accounts, import, sync, launch, delete-campaign.

LAUNCH PUSHES A SEQUENCE + ADDS LEADS (launch(), 193-372; called by useLaunchCampaign api.ts:340-368). Linear chain of REST calls, each followed by 300ms delay(), all wrapped in try/catch that best-effort DELETEs the Smartlead campaign on any failure (358-361, no orphans):
1. POST /campaigns/create {name} -> campaignId (200-205).
2. POST /campaigns/{id}/sequences (217-228): each input step -> {seq_number, seq_delay_details:{delay_in_days: delay_days}, subject, email_body: body_html}. This is THE sequence push — one flat Smartlead email sequence; delay_in_days is the per-step gap, so the cadence is relative-per-lead, not calendar-pinned.
3. POST /campaigns/{id}/schedule (232-244): timezone, days_of_the_week (default M-F [1,2,3,4,5]), start/end hour, min_time_btw_emails (default 15), max_new_leads_per_day (default 25). THE THROTTLE lives here.
4. POST /campaigns/{id}/email-accounts (249-258): attach the ONE sending inbox (p.email_account_id).
5. POST /campaigns/{id}/leads (262-287): recipients added in batches of 400, one retry per failed batch; counts leads_added/leads_failed; throws if ALL batches fail. Only email/first_name/last_name/company_name are sent (266-271) — Smartlead merge fields are limited to these four.
6. Insert a playbook_campaigns row (status 'planned', smartlead_campaign_id, owner) BEFORE any start, fatal if it fails (295-312).
7. Mark source idea executed (316-321).
8. Log one 'email' activity per linked contact for timeline visibility (323-342) — non-fatal.
9. Optional START: POST /campaigns/{id}/status {status:"START"} only if autoStart===true (default FALSE -> lands as a Smartlead DRAFT); on success promotes playbook_campaigns to in_progress (347-357).

THROTTLE TODAY: the only throttle is Smartlead's own max_new_leads_per_day in the schedule body. CampaignWizard.tsx:143 passes schedule.max_new_leads_per_day=leadsPerDay + min_time_btw_emails=minGap. Smartlead trickles new leads in at that rate and each lead walks the sequence from the day ITS first email actually sends (relative delays). There is NO first_send_at anchoring, NO enroll_position math, and NO per-lead CRM-side scheduling anywhere in code yet — those columns exist only in the schema.

REPLY/PAUSE DETECTION: POLLING ONLY, no webhooks. syncCampaigns() (140-160) and importCampaigns() (93-138) loop already-imported campaigns, re-pull fetchCampaignById + fetchCampaignAnalytics, and merge fresh metrics (incl. reply_count via buildSmartleadMetrics). advancedStatus() (87-91) only ever PROMOTES status forward (planned->in_progress->complete). Replies surface ONLY as the aggregate metrics.replies number on the campaign; nothing maps a reply to a specific lead/enrollment, and nothing pauses anything. The daily cron hits action:"sync" with the service-role bearer. import/sync are wired in api.ts via useImportCampaigns/useSyncCampaigns (216-240).

**Built vs stub:** BUILT (working today, admin-only, staging): the full Smartlead read+launch path against the LEGACY playbook_campaigns table — create campaign, push one flat email sequence, set schedule/throttle, attach inbox, batch-add leads, optional START, plus import/sync metric polling and delete-campaign. Rollback-on-failure and rate-limited serial client are solid and load-bearing (ported verbatim from Nexus).

SCHEMA-ONLY, NO CODE (the gap to the plan): campaigns + campaign_enrollments tables and the activities columns (campaign_enrollment_id, campaign_step_number, is_campaign_generated) exist in migration 20260625000001_campaigns_foundation.sql with first_send_at, enroll_position, leads_per_day, anchor_date, current_step columns — but NOTHING reads or writes them. Confirmed via grep: the only code hits for leads_per_day/first_send_at/enroll_position are CampaignWizard.tsx:143 (Smartlead schedule throttle, unrelated to enrollment) and index.ts:242 (the schedule default). So per-lead anchoring, enrollment rows, manual CALL/LINKEDIN task spawning, and the trigger/pause engine are entirely unbuilt — exactly Phase 1-2 of the plan.

NOTE: launch() writes to playbook_campaigns, NOT the new campaigns table — the two are currently disconnected. The new enrollment-driven flow needs to bridge them (store smartlead_campaign_id on campaigns and write one campaign_enrollments row per recipient at launch).

**Gaps:** WHAT'S NEEDED to drive EMAIL_AUTO from a campaign_enrollment:
1. LAUNCH must write the new tables. Today launch() only creates playbook_campaigns. It needs to (a) insert a campaigns row carrying smartlead_campaign_id + leads_per_day + anchor_date, and (b) insert one campaign_enrollments row per recipient with enroll_position assigned in upload order (the same order passed to POST /leads), so per-lead anchoring is deterministic.
2. PER-LEAD ANCHORING is unimplemented. Plan formula (§5): first_send_at(n) = anchor + floor((enroll_position-1)/leads_per_day) days snapped to a send weekday. Smartlead's max_new_leads_per_day must equal the campaign's leads_per_day for the math to match reality — currently they're independent values (schedule default 25 vs enrollment leads_per_day default 20: a real mismatch that would desync CRM task dates from actual sends). Reconcile these.
3. RECONCILIATION JOB doesn't exist. Plan needs a daily job reading Smartlead's actual per-lead sent state to correct first_send_at drift, then re-date downstream CALL/LINKEDIN tasks. Smartlead's lead-level send status (per-lead message history) is NOT fetched anywhere today — only campaign-aggregate analytics. A new helper (e.g. fetch lead statuses per campaign) is required.
4. REPLY/PAUSE is aggregate-only. sync polls campaign-level reply_count; it cannot tell WHICH lead replied, so it cannot pause a specific enrollment or cancel that enrollment's pending tasks (the plan's core pause behavior). Need per-lead reply data (Smartlead per-lead message/reply endpoint) — or the later EMAIL_REPLY webhook. 24h polling lag is accepted for v1 per plan §6.
5. ORDER ASSUMPTION RISK: enroll_position assumes Smartlead sends in upload order at exactly leads_per_day/day. The plan itself flags (§5) that how Smartlead divides one mailbox across multiple campaigns (fair-share vs first-come) is unconfirmed — if not fair-share, CRM task dates drift and the daily reconciliation becomes load-bearing, not optional.
6. EMAIL_HYBRID/CALL/LINKEDIN steps are not pushed to Smartlead at all (correct — Smartlead is email-only); they must be spawned as activities rows keyed by campaign_enrollment_id. None of that spawning code exists yet.
7. STATUS never demotes (advancedStatus, index.ts:87-91): a Smartlead PAUSED maps to in_progress and can't move back to planned — fine for the legacy tracker but the new enrollment status machine (active|paused|stopped|replied|bounced) needs independent bidirectional handling.

### enrollment-tasks
The schema and the "Up Next" surface both exist, but the ENGINE that connects them does not — there is zero code that enrolls a contact or spawns a step task. Everything between "template" and "task in Up Next" is unbuilt.

WHAT EXISTS (data foundation only, migration 20260625000001_campaigns_foundation.sql):
- Three tables: campaign_templates (seeded with 8-Touch + Warming presets, steps as jsonb), campaigns (launched instance; columns leads_per_day default 20, anchor_date, status draft|active|paused|completed|stopped, smartlead_campaign_id), and campaign_enrollments (one row per contact; columns enroll_position, first_send_at, current_step, status active|paused|completed|stopped|replied|bounced, paused_reason). Unique index uq_enrollment_campaign_contact(campaign_id, contact_id) enforces no double-enroll. Indexes idx_enrollment_owner_status and idx_enrollment_contact_status are in place.
- activities got the three trace columns (campaign_enrollment_id, campaign_step_number, is_campaign_generated default false) + a partial index idx_activities_campaign_enrollment — migration 20260625000001 lines 87-92. So the link column the plan §4 calls for is ready.
- RLS is admin-only on all three tables (Phase 5 would open to reps).

HOW 'UP NEXT' SURFACES TASKS (already works, generically):
- src/features/dashboard/HomePage.tsx useMyTasks (lines 151-168) selects activities where activity_type='task' AND owner_user_id = me AND archived_at IS NULL, ordered by due_at. It does NOT filter on is_campaign_generated — so ANY task row owned by the rep shows up automatically. This means a spawned campaign task would appear in Up Next the moment it's inserted with activity_type='task', owner_user_id, subject, due_at. No Up Next changes needed.
- The task-reminders edge function (supabase/functions/task-reminders, runs every ~5 min) + the existing reminder columns (reminder_at, reminder_schedule, reminder_channels) are the verified recipe the plan §4 points at for notifications.

WHAT'S MISSING — THE ENTIRE ENGINE:
1. No enroll path. grep for 'enroll', 'campaign_enrollment', 'first_send_at' across src returns NOTHING outside the migration. api.ts has no useEnroll / insert into campaigns or campaign_enrollments. TemplatesSection.tsx 'Use this template' button is hard-disabled (line 122); the from-scratch card is disabled (line 81). The only launch path (api.ts useLaunchCampaign → playbook-smartlead 'launch') creates a Smartlead campaign + a playbook_campaigns row, and inserts an activities row PER RECIPIENT — but that row is activity_type='email' (a timeline log, lines 326-340), NOT a task, and never writes campaign_enrollment_id or is_campaign_generated. It does not create campaigns/campaign_enrollments rows at all.
2. No per-lead anchoring. first_send_at is never computed or written anywhere. The plan §5 formula first_send_at(n) = anchor + floor((enroll_position-1)/leads_per_day) exists only as prose. enroll_position is never set.
3. No cron/edge fn that walks enrollments to create due tasks. There is NO scheduler that reads campaign_enrollments, computes each step's date off that lead's first_send_at, and inserts CALL/LINKEDIN/EMAIL_HYBRID activities. (Existing crons: task-reminders, task-digest, meddy-sweep, pandadoc-sync, outlook-calendar-sync, the renewals/lifecycle sweep — none touch campaigns.)
4. No reconciliation, no reply/pause/stop engine, no task-cancel-on-pause. The plan §6 trigger engine (read Smartlead reply/unsub counts, pause enrollment, cancel pending campaign-generated tasks) does not exist.

**Built vs stub:** BUILT: the DB foundation (3 tables + activities link columns + indexes + RLS + 2 seeded presets) and the generic Up Next surface (HomePage useMyTasks shows any activity_type='task' row; task-reminders cron + reminder columns deliver notifications). The visual template gallery + read-only timeline preview are built.

STUB / NOT BUILT (everything that makes it an engine): enrollment write path (no insert into campaigns/campaign_enrollments anywhere); enroll_position + first_send_at computation (plan §5 throttle math — prose only); the cron/edge fn that walks enrollments and spawns CALL/LINKEDIN/HYBRID tasks anchored per-lead off first_send_at (does NOT exist — no scheduler references campaign_enrollments); Smartlead-send reconciliation of first_send_at; reply/meeting/unsub pause-stop trigger engine; cancel-pending-tasks-on-pause; the 'Use this template' / 'Custom sequence' launch buttons (both hard-disabled). The plan itself labels this Phase 1 'the core loop' and it is entirely ahead of the current code.

Note: the playbook-smartlead 'launch' activities insert (per-recipient) is a misleading near-miss — it writes to activities but as activity_type='email' timeline logs, not tasks, and sets none of the campaign_enrollment_id/is_campaign_generated columns.

**Gaps:** GAP TO A WORKING ENGINE (in dependency order):
1. Enroll path: a server-side write (edge fn or RPC, since RLS is admin-only and enroll_position must be assigned atomically) that, given a campaign + a recipient list, inserts a campaigns row, then campaign_enrollments rows with monotonically increasing enroll_position, and computes first_send_at = anchor + floor((enroll_position-1)/leads_per_day) snapped to a send weekday. Must filter through the Do-Not-Email suppression view (migration 20260624000006-08) and respect the unique (campaign_id, contact_id) index for idempotency. The plan frames suppression as a SOFT alert, so this should EXCLUDE-by-default-but-not-hard-block.
2. Smartlead linkage: enrollment must also push the EMAIL_AUTO steps to Smartlead (the launch fn already creates the campaign + adds leads with max_new_leads_per_day, line 242) and store smartlead_campaign_id on the campaigns row — currently launch only writes playbook_campaigns, a SEPARATE legacy table. Risk: two parallel campaign tables (playbook_campaigns vs new campaigns) with overlapping purpose — must decide which is the source of truth or they will drift.
3. The step-spawner cron: a daily edge fn that, per active enrollment, looks at each non-email step, computes due_at = first_send_at + day_offset (snapped to weekday_target / call_days), and inserts an activities task (activity_type='task', owner_user_id=enrollment.owner, subject from manual_task_title_template, due_at, priority, reminder_*, campaign_enrollment_id, campaign_step_number, is_campaign_generated=true) IF not already created (dedupe on (campaign_enrollment_id, campaign_step_number)). Advance current_step. This is the single biggest missing piece.
4. Reconcile first_send_at from Smartlead actual sends (daily) so throttled leads' tasks ride the real send — until then dates are only the deterministic estimate, which the plan itself flags as the exact bug to avoid if anchoring is wrong.
5. Pause/stop engine + cancel pending campaign-generated tasks (where is_campaign_generated AND completed_at IS NULL) on reply/meeting/unsub, plus the rep-facing Stop & Edit controls (Nathan's feedback-round-1 first-class requirement).

RISKS: (a) admin-only RLS means reps can't be owners of enrollments yet, but tasks are owned by reps and Up Next is per-user — the spawner must run as service-role to insert rep-owned tasks. (b) Cadence: 8-Touch call days land Mon/Fri from a Monday anchor (decided: keep as-is) — the spawner's weekday snapping must not silently re-derive to Tue/Fri. (c) No webhook; 24h polling lag is accepted for v1, so a reply can still fire one more task before pause — acceptable per plan but worth a dedupe/cancel guard.

### plan-doc
ORCHESTRATOR MODEL (§2, plan:33-49): "No single tool owns a sequence. Campaigns is an orchestrator." The deliberate lesson from history is that the native "Sequences" feature was removed in June (commit 487c4fe, 1,721 lines, tables dropped) to avoid building an email-sending engine that competes with Smartlead. So work is split by step type (plan:39-46): EMAIL_AUTO steps (Days 1,5) run in Smartlead as a campaign+throttle; CALL (Days 8,19), LINKEDIN (Days 12,23), and EMAIL_HYBRID (Days 15,26) steps are `activities` rows assigned to the contact's owner and surfaced by the EXISTING task-reminders edge fn (every 5 min) + Up Next widget. Smartlead is email-only and cannot do calls/LinkedIn/tasks (confirmed). Pause/stop runs through the CRM trigger engine via daily Smartlead sync + opp/contact watchers. They are NOT rebuilding delivery — only scheduling and coordinating.

UNIFIED-BUILDER FRAMING (§2.5, Nathan's north star, plan:53-68): There is ONE builder; everything is that builder in a different starting state. Templates (8-Touch, Warming) = the builder pre-loaded with a saved setup. From-scratch = the same builder empty. From-a-contact = the same builder opened on that person with a template applied. Template gallery / enrollment / quick-enroll are all "thin entry points" into the one builder. "We build one great builder + a launch path."

PER-LEAD THROTTLE ANCHORING (§5, the heart of "always works", plan:134-178): The real bottleneck is the SENDING MAILBOX (~20-40/day, shared across all that rep's campaigns), not the campaign — so a per-campaign size cap doesn't help. Key realization: the sequence timeline is per-PERSON, not per-campaign. Smartlead trickles people in via max_new_leads_per_day; each person walks the sequence on their own clock starting the day THEIR first email actually sends. The naive bug Nathan foresaw (plan:146-149): anchoring every contact's call tasks to one campaign "start Monday" means contact #45 — throttled, won't get their intro email until day 2-3 — gets a call task scheduled BEFORE their email goes out. The fix (plan:151-159): first_send_at(lead n) = anchor + floor((n-1)/leads_per_day) days, snapped to a send day; every step's date computed off THAT lead's first_send_at, not a global anchor; a DAILY RECONCILIATION job reads Smartlead's actual sent counts and corrects drift; (later) a Smartlead EMAIL_SENT webhook makes it real-time, not needed for v1. The throttle is made visible via a plain-English ramp projection from the inbox's REMAINING headroom, and the setup screen sums the rep's active leads_per_day across campaigns to warn before oversubscribing.

SOFT-DNC ALERT (§13, plan:279-281 + task framing): Suppression is a SOFT Do-Not-Contact alert, never a hard block. Enrollment filters through the hardened "Do Not Email" suppression view (customers, partners, DNC, unsubscribed), on by default, shown as "50 selected → 47 eligible (3 suppressed)" — easy to exclude, surfaced as an alert/count rather than enforced suppression. Other guardrails: never double-enroll, idempotent enrollment+launch (campaign_enrollment_id uniqueness guard), pause cancels pending tasks, immutable launched campaigns (edits clone a new version since Smartlead can't edit post-launch), pre-flight gate (launch disabled until every check green).

REPLY/PAUSE/STOP (§6, plan:182-190): No webhooks today — Smartlead exposes replies/unsubscribes via daily metric polling (existing 12:30 UTC sync). v1 trigger engine in the daily job: reply or meeting-booked (opp created) → pause enrollment, notify owner, cancel pending campaign tasks; unsubscribe/bounce → stop enrollment + set contact.do_not_contact=true; rep logs "Not Interested" → stop. 24h lag acceptable for v1.

**Built vs stub:** PER THE PLAN'S OWN STATUS MARKERS (the doc describes intended state; code not re-verified in this pass):

DONE / shipped to staging:
- Phase 0 RENAME (plan:72): sidebar "Campaigns" (Megaphone icon, route stays /playbook), sub-tabs Campaigns·Playbook·Newsletters (Campaigns first + default) — marked done.
- From feedback round 1 (plan:304-315): Campaigns list = Ongoing + Past — marked DONE. 8-Touch corrections (all emails AUTO, rep edits copy before launch; only calls+LinkedIn are tasks; preview derives weekdays from day offset, Monday start) — marked DONE. Cadence decision (calls land Mon/Fri) — DECIDED, keep as-is. Meddy slow first-load image perf — DONE (separate). Import button UI glitch — closed/resolved.

The git history in context corroborates Phase 1 partial delivery: commit 1f04dfa "Campaigns Phase 1: template gallery + visual sequence timeline" and cdabc75 "Campaigns Phase 1: data foundation (templates, campaigns, enrollments) + seed 8-Touch & Warming" — so the data foundation, template gallery, read-only timeline, and 8-Touch + Warming seeds appear landed.

STILL STUB / NOT YET DONE (flagged in plan):
- Polish notes for NEXT build (plan:317-323): Pulse-styled delete confirmation (delete works + deletes in Smartlead, but 2nd-click confirm still uses native browser confirm()); Training widget tidy-up (TrainingPanel chat bubbles + saved-training items run edge-to-edge, need padding/insets).
- "Warming sequence" cadence is UNDEFINED in any doc (plan:332) — §9 proposes a 3-5 email email-only default; needs Nathan's real cadence.
- Stop & Edit mid-flight (plan:295-301) is a NEW first-class requirement from feedback round 1 — the step state machine for "scheduled, not yet sent" steps being editable+cancellable per-enrollment is design-stage, not built.
- The core enrollment loop, per-lead throttle math, Smartlead push of email steps, manual-task spawning, trigger engine, AI drafting, editable/drag builder, and self-serve RLS are all later phases (1 remaining → 5) — not yet built per the phase plan.

**Gaps:** BUILD ORDER the plan specifies (§11, plan:251-264): Phase 0 — Rename (done) + 5 bug fixes (make today's tool trustworthy first). Phase 1 — Template + Enrollment MVP (the core loop): tables, seed 8-Touch, template gallery + read-only timeline, enroll a list, per-lead throttle math, push email steps to Smartlead, spawn manual tasks into Up Next, active-campaigns list. Phase 2 — Trigger engine (daily reply/meeting/unsub → pause/stop + cancel tasks; fast-path quick-enroll from a contact; mailbox-headroom projection UI). Phase 3 — AI drafting + optimize (per-step AI with whole-sequence context, subject A/B, optimize-sequence). Phase 4 — Editable builder (drag/reorder/insert steps, custom templates, clone). Phase 5 — Self-serve non-admin (RLS for reps, oversend/suppression guardrails, per-rep sending-capacity view). Phase 6 — Real-time webhooks, analytics, mobile (later polish).

THE "5 BUGS TO FIX FIRST" (Phase 0, §10, plan:236-246 — all flagged "confirm against live code/prod before fixing"):
1. Newsletter text underlined — stray <u> from the model or preview-iframe link underlining → strip <u> in parser + style links by color/weight not underline.
2. No Mailchimp audience on push — pushToMailchimp copies list_id but not the segment; empty source recipients silently makes an audience-less draft → validate recipients, copy list_id AND segment_opts, throw (don't silently create) if absent.
3. Subject formatting not followed — parseDraftResult/parseReviseResult run stripEm/fixSpacing on the SUBJECT, mangling it → stop post-processing the subject; let AI formatting stand.
4. Smartlead campaigns oldest-first — list not reliably sorted newest-first (bulk-import ties on created_at) → sort by Smartlead campaign id / created desc with a stable tiebreaker. (This is also "Bug #4" referenced in the IA section, plan:80.)
5. Mailchimp ingest failed on PROD — likely MAILCHIMP_API_KEY not set on prod Supabase project, or ingest exceeds the 150s edge limit on a large account → confirm prod secret; make ingest resilient (cap per run, per-fetch timeout, partial-success, less frequent).

RISKS / OPEN ITEMS the plan itself flags:
- Cross-campaign mailbox division: how Smartlead splits ONE mailbox across multiple campaigns (fair-share vs first-come) is unconfirmed (plan:170-172); if not fair, add a CRM-side enrollment meter. Per-lead anchoring holds either way.
- Smartlead has no real-time webhooks today — v1 relies on 24h-lag daily polling (plan:182-190); single-anchor date math would mis-schedule throttled leads, hence per-lead anchoring is mandatory not optional.
- Smartlead only merges first_name/last_name/company_name/email — deeper AI personalization must be PRE-RENDERED per lead before upload (plan:217-218), a real constraint.
- Launched campaigns are immutable (Smartlead can't edit post-launch) — conflicts with the new "Edit mid-flight" requirement; may need clone-forward (plan:286, 295-301).
- Research corrections (plan:327-332): old sequences/sequence_enrollments/playbook_sequences tables were DROPPED June 15 (20260613000005_remove_sequences.sql) — all sequence tables here are net-new; playbook_campaigns (Smartlead execution tracker) stays. Warming cadence still undefined, needs Nathan's real cadence.
- CONTEXT MISMATCH worth flagging: the task brief cites migration 20260625000001 for the campaign tables, but the plan/git commits reference seeding done earlier — worth confirming the actual migration filename when touching schema. I did not open the migrations or feature code in this pass (mapped from the plan doc only), so the built-vs-stub split above is per the doc's own status markers + git log, not a fresh code read.

## Slices

1. **1 - EDITOR over SequenceStep array** — files: NEW SequenceEditor.tsx; EDIT api.ts template CRUD; EDIT TemplatesSection.tsx wire button line 122 and Custom card 81-95
   Unified builder reusing SequenceTimeline icons add remove reorder channel day_offset window automation email subject body persist campaign_templates.steps recompute step_count duration_days weekday_target decorative

2. **2 - ENROLLMENT plus soft DNC alert** — files: NEW EnrollDialog.tsx; EDIT api.ts fetchSuppressionForEmails over v_marketing_suppression not the hard fetchRecipientsByTag filter; REUSE CampaignRecipients.tsx
   eligible equals selected minus v_marketing_suppression by normalized email plus per row override block double enroll via uq_enrollment_campaign_contact dry run preview only

3. **3 - LAUNCH BRIDGE** — files: EDIT playbook-smartlead/index.ts new action launch-campaign keep legacy launch; EDIT api.ts V2 hooks; EDIT EnrollDialog.tsx; REUSE _shared/smartlead.ts
   Insert campaigns frozen steps leads_per_day anchor_date inbox enroll_position 1 to N upload order first_send_at anchor plus floor pos minus 1 over leads_per_day push EMAIL_AUTO via create sequence schedule email-accounts leads chain max_new_leads_per_day equals leads_per_day store smartlead_campaign_id idempotent autoStart OFF pre render personalization reuse rollback

4. **4 - ENGINE step-spawner cron** — files: NEW supabase/functions/campaign-engine/index.ts; NEW engine-columns migration UNIQUE index; NEW cron migration mirror 20260522000003; NEW campaign-engine.yml; REUSE task-reminders recipe and HomePage useMyTasks
   Per active enrollment per non EMAIL_AUTO due step first_send_at plus day_offset snapped unspawned insert activities task type task owner subject body from manual_task_title_template task_note_template due_at priority reminder_schedule once reminder_channels in_app email campaign_enrollment_id campaign_step_number is_campaign_generated true advance current_step EMAIL_HYBRID review task service-role Mon Fri cadence skip paused stopped replied

5. **5 - RECONCILE first_send_at** — files: EDIT _shared/smartlead.ts fetchCampaignLeadStatuses per-lead endpoint; EDIT campaign-engine/index.ts set smartlead_lead_id correct first_send_at re-date future tasks
   Daily read Smartlead per lead sent state fix throttle drift shift only future incomplete tasks match by email 24h lag ok confirm endpoint returns sent timestamps never move a completed task

6. **6 - TRIGGERS pause stop** — files: EDIT playbook-smartlead/index.ts syncCampaigns per lead reply unsub enrollment status cancel pending tasks via archived_at; EDIT campaign-engine/index.ts new opp pause unsub bounce stop plus contact.do_not_contact; EDIT api.ts
   In the daily sync no webhooks reply meeting pauses cancels pending tasks notifies owner unsub bounce stops sets do_not_contact mapping needs per lead data Step 5 plus smartlead_lead_id cancel equals archive

7. **7 - STOP plus EDIT mid-flight plus polish** — files: EDIT CampaignsTab.tsx Stop Pause Edit styled delete confirm; NEW CampaignManageView.tsx; EDIT api.ts stop plus clone-forward via source_campaign_id; EDIT playbook-smartlead/index.ts clone-forward; EDIT TrainingPanel.tsx padding
   Stop halts cancels pending tasks Step 6 helper Edit not yet sent CRM tasks in place EMAIL_AUTO clones forward new campaigns row via source_campaign_id migrate un started enrollees stop original polish styled confirm TrainingPanel padding migrate only future current_step 0 enrollees
