-- =============================================================================
-- 003: FA Full-Time link (2026-11-13)
-- Run in the Supabase SQL editor. Safe to re-run. Also in supabase/schema.sql.
--
-- Links each team to its exact name on FA Full-Time (e.g. "Fusion FC U8 Black")
-- so its page can show fixtures, results and the league table from the
-- scheduled Full-Time snapshot. Managers can set it for their own teams.
-- =============================================================================
alter table public.teams add column if not exists fulltime_name text;

notify pgrst, 'reload schema';
