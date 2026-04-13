-- ============================================================
-- Migration: Add FTE snapshot fields to opportunities
-- Date: 2026-04-13
-- Description:
--   Captures FTE count and range at the time an opportunity is
--   created, enabling historical tracking of client growth
--   across opportunities without back-updating old records.
-- ============================================================

alter table public.opportunities
  add column if not exists fte_count integer check (fte_count is null or fte_count >= 0),
  add column if not exists fte_range text;
