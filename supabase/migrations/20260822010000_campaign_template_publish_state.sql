-- campaign_template_publish_state: durable visibility control
--
-- Adds a publish_state column so unfinished preset templates (e.g. Warming)
-- stay hidden from selection UIs and AI recommendations until explicitly
-- published. Custom user templates are auto-published on save (they actively
-- chose to save). Presets are admin-controlled.
--
-- Rollback: ALTER TABLE campaign_templates DROP COLUMN publish_state;
--           + restore the old campaign_templates_read_own policy (no publish filter).

-- 1. Add column with safe default (new rows start as draft, hidden until published)
ALTER TABLE public.campaign_templates
  ADD COLUMN IF NOT EXISTS publish_state text NOT NULL DEFAULT 'draft'
    CHECK (publish_state IN ('draft', 'published', 'archived'));

-- 2. Backfill ALL existing templates to published first — every row that
--    existed before this migration was either an approved preset or a
--    user-saved custom template (both intentionally visible). This covers
--    any future presets added before the migration runs too.
UPDATE public.campaign_templates
SET publish_state = 'published'
WHERE publish_state = 'draft';

-- 3. Then override the one known-unfinished preset: Warming → draft.
--    Only this exact UUID is hidden; every other existing row stays published.
UPDATE public.campaign_templates
SET publish_state = 'draft'
WHERE id = '11111111-0000-4000-a000-000000000002';

-- 4. Update rep-facing SELECT policy: only see published presets + own templates
--    (owner sees own drafts for management; presets hidden until published)
DROP POLICY IF EXISTS "campaign_templates_read_own" ON public.campaign_templates;
CREATE POLICY "campaign_templates_read_own"
  ON public.campaign_templates
  FOR SELECT TO authenticated
  USING (
    (is_preset = true AND publish_state = 'published')
    OR owner_user_id = (SELECT auth.uid())
  );
