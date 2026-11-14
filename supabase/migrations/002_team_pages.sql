-- =============================================================================
-- 002: Team pages (2026-11-13)
-- Run in the Supabase SQL editor. Safe to re-run. Also included at the end of
-- supabase/schema.sql, so fresh projects get it automatically.
--
-- Adds what a team's public page shows and its managers can edit, private
-- team contact details (like vacancy_contacts), and a bucket for team photos.
-- =============================================================================

-- Public team details managers can edit (identity fields stay admin-only via
-- the guard_team_fields trigger).
alter table public.teams add column if not exists photo_url text;
alter table public.teams add column if not exists training_venue text;
alter table public.teams add column if not exists home_ground text;
alter table public.teams add column if not exists fulltime_url text;
-- "Message the coach" on the team page. Public: the name and which channels
-- are on. Private: the number/email (team_contacts below).
alter table public.teams add column if not exists contact_name text;
alter table public.teams add column if not exists whatsapp_enabled boolean not null default false;
alter table public.teams add column if not exists email_enabled boolean not null default true;

-- Private contact details for a team. Staff only; the website's server reads
-- them (service role) when a parent taps WhatsApp or sends a message.
create table if not exists public.team_contacts (
  team_id uuid primary key references public.teams (id) on delete cascade,
  whatsapp_number text,   -- international digits, e.g. 447700900123
  email text              -- where team enquiries go; else the team's managers
);
alter table public.team_contacts enable row level security;
drop policy if exists "team_contacts staff all" on public.team_contacts;
create policy "team_contacts staff all" on public.team_contacts
  for all using (public.is_club_admin() or public.manages_team(team_id))
  with check (public.is_club_admin() or public.manages_team(team_id));

-- -----------------------------------------------------------------------------
-- Team photos: public bucket, files stored as <team_id>/<file>. Admins and
-- that team's managers can upload/replace/delete.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-photos', 'team-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_team_path(p text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare t uuid;
begin
  begin
    t := split_part(p, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return public.is_club_admin() or public.manages_team(t);
end;
$$;

drop policy if exists "team-photos public read" on storage.objects;
create policy "team-photos public read" on storage.objects
  for select using (bucket_id = 'team-photos');
drop policy if exists "team-photos staff insert" on storage.objects;
create policy "team-photos staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-photos' and public.can_manage_team_path(name));
drop policy if exists "team-photos staff update" on storage.objects;
create policy "team-photos staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'team-photos' and public.can_manage_team_path(name));
drop policy if exists "team-photos staff delete" on storage.objects;
create policy "team-photos staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-photos' and public.can_manage_team_path(name));

notify pgrst, 'reload schema';
