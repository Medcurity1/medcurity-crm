-- ============================================================
-- 8-Touch template fix (Nathan 2026-06-23): all email steps are AUTOMATED.
--
-- The seed (20260625000001) followed Jordan's doc, which marked the Day 15 +
-- Day 26 emails as HYBRID ("rep reviews & sends"). Per Nathan, ALL emails in the
-- 8-Touch should send automatically (the person setting up the campaign can edit
-- the copy as they choose before launch) — only calls + LinkedIn are rep tasks.
-- So steps 5 and 8 flip EMAIL_HYBRID/HYBRID -> EMAIL_AUTO/AUTO and drop their
-- manual-task fields.
--
-- (Separate, surfaced to Nathan: the day-offset -> weekday mapping in the doc
-- is internally inconsistent — e.g. "Day 8 = Tuesday" is actually Monday from a
-- Monday start. The preview now derives the weekday from the offset so it's
-- always accurate; whether to nudge the call days to land on Tue/Fri is a
-- cadence decision left to Nathan.)
--
-- Idempotent: rewrites the full steps array for the fixed 8-Touch id.
-- ============================================================

begin;

update public.campaign_templates
set steps = $steps$[
    {"order":1,"day_offset":1,"channel":"EMAIL_AUTO","weekday_target":"MON","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":2,"day_offset":5,"channel":"EMAIL_AUTO","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":3,"day_offset":8,"channel":"CALL","weekday_target":"TUE","send_window_start":"10:00","send_window_end":"12:00","automation":"MANUAL","manual_task_title_template":"Call {{first_name}} @ {{company}}","manual_task_priority":"high","task_note_template":"First call attempt. Reference the Day 5 email."},
    {"order":4,"day_offset":12,"channel":"LINKEDIN","weekday_target":"WED","send_window_start":"09:00","send_window_end":"10:00","automation":"MANUAL","manual_task_title_template":"LinkedIn connect: {{first_name}}","manual_task_priority":"normal","task_note_template":"Send a connection request (no pitch)."},
    {"order":5,"day_offset":15,"channel":"EMAIL_AUTO","weekday_target":"MON","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":6,"day_offset":19,"channel":"CALL","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"12:00","automation":"MANUAL","manual_task_title_template":"Call {{first_name}} @ {{company}}","manual_task_priority":"high","task_note_template":"Second call attempt. Reference LinkedIn or prior opens."},
    {"order":7,"day_offset":23,"channel":"LINKEDIN","weekday_target":"TUE","send_window_start":"09:00","send_window_end":"10:00","automation":"MANUAL","manual_task_title_template":"LinkedIn message: {{first_name}}","manual_task_priority":"normal","task_note_template":"Short, personal message now that you're connected. No pitch."},
    {"order":8,"day_offset":26,"channel":"EMAIL_AUTO","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""}
  ]$steps$::jsonb,
  updated_at = now()
where id = '11111111-0000-4000-a000-000000000001';

commit;

notify pgrst, 'reload schema';
