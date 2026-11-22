-- 008: team sponsors.
--
-- A team's managers (and club admins) add the team's sponsors in the portal;
-- they show on that team's public page. Logos go in the existing team-photos
-- bucket under <team_id>/sponsors/, which only that team's managers and club
-- admins can write to. Safe to re-run.

create table if not exists public.team_sponsors (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  website text check (website is null or website ~* '^https?://'),
  logo_url text,
  blurb text check (blurb is null or char_length(blurb) <= 300),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_sponsors_team on public.team_sponsors (team_id, sort_order);

drop trigger if exists team_sponsors_touch on public.team_sponsors;
create trigger team_sponsors_touch before update on public.team_sponsors
  for each row execute function public.touch_updated_at();

alter table public.team_sponsors enable row level security;

-- Anyone can see the sponsors of published teams.
drop policy if exists "team_sponsors public read" on public.team_sponsors;
create policy "team_sponsors public read" on public.team_sponsors
  for select using (
    exists (select 1 from public.teams t where t.id = team_id and t.published)
    or public.is_club_admin()
    or public.manages_team(team_id)
  );

-- Admins and the team's own (approved) managers add, edit and remove them.
-- "with check" stops a manager moving a sponsor onto another team.
drop policy if exists "team_sponsors staff write" on public.team_sponsors;
create policy "team_sponsors staff write" on public.team_sponsors
  for all using (public.is_club_admin() or public.manages_team(team_id))
  with check (public.is_club_admin() or public.manages_team(team_id));

grant select on public.team_sponsors to anon, authenticated;
grant insert, update, delete on public.team_sponsors to authenticated;

notify pgrst, 'reload schema';
