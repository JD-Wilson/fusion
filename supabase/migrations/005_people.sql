-- =============================================================================
-- 005: People and development sessions (2026-11-14)
-- Run in the Supabase SQL editor. Safe to re-run. Also in schema.sql.
--
-- A person is anyone who coaches or helps run the club: name, email and
-- mobile, with or without a login. One person can be on many teams, and a
-- club admin can coach teams too. team_managers now points at a person;
-- triggers keep its user_id and display_name in step with that person, so
-- the existing permission checks (manages_team) carry on working.
-- =============================================================================

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) > 0),
  email text,
  phone text,
  notes text,
  user_id uuid unique references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists people_email_key
  on public.people (lower(email)) where email is not null;

drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people
  for each row execute function public.touch_updated_at();

alter table public.team_managers
  add column if not exists person_id uuid references public.people (id) on delete cascade;
create unique index if not exists team_managers_team_person
  on public.team_managers (team_id, person_id) where person_id is not null;

-- -----------------------------------------------------------------------------
-- Copy in what exists: a person for every login, then for every manager row.
-- -----------------------------------------------------------------------------
insert into public.people (full_name, email, phone, user_id)
select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), p.email, p.phone, p.id
from public.profiles p
where not exists (select 1 from public.people x where x.user_id = p.id)
on conflict do nothing;

update public.team_managers tm
set person_id = pe.id
from public.people pe
where tm.person_id is null and tm.user_id is not null and pe.user_id = tm.user_id;

do $$
declare
  r record;
  pid uuid;
begin
  for r in select id, display_name from public.team_managers where person_id is null loop
    insert into public.people (full_name) values (r.display_name) returning id into pid;
    update public.team_managers set person_id = pid where id = r.id;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Keep team_managers in step with the person (user_id drives permissions).
-- -----------------------------------------------------------------------------
create or replace function public.team_manager_from_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null then
    select pe.user_id, pe.full_name into new.user_id, new.display_name
    from public.people pe where pe.id = new.person_id;
  end if;
  return new;
end;
$$;
drop trigger if exists team_managers_from_person on public.team_managers;
create trigger team_managers_from_person before insert or update on public.team_managers
  for each row execute function public.team_manager_from_person();

create or replace function public.people_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_managers
  set user_id = new.user_id, display_name = new.full_name
  where person_id = new.id
    and (user_id is distinct from new.user_id or display_name is distinct from new.full_name);
  -- The login's name and mobile follow the person (and back, below).
  if new.user_id is not null then
    update public.profiles
    set full_name = new.full_name, phone = new.phone
    where id = new.user_id
      and (full_name is distinct from new.full_name or phone is distinct from new.phone);
  end if;
  return new;
end;
$$;
drop trigger if exists people_sync on public.people;
create trigger people_sync after insert or update on public.people
  for each row execute function public.people_sync();

create or replace function public.profile_to_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.people
  set full_name = coalesce(nullif(btrim(new.full_name), ''), full_name), phone = new.phone
  where user_id = new.id
    and (full_name is distinct from coalesce(nullif(btrim(new.full_name), ''), full_name) or phone is distinct from new.phone);
  return new;
end;
$$;
drop trigger if exists profiles_to_person on public.profiles;
create trigger profiles_to_person after update of full_name, phone on public.profiles
  for each row execute function public.profile_to_person();

-- A new login joins up with the person who has that email (or becomes one).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  update public.people set user_id = new.id
  where user_id is null and lower(email) = lower(new.email);
  if not found then
    insert into public.people (full_name, email, user_id)
    values (
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      new.id
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Who can see people: admins (everything), yourself, and fellow managers of
-- your teams. Only admins add, change or remove people.
-- -----------------------------------------------------------------------------
alter table public.people enable row level security;
drop policy if exists "people staff read" on public.people;
create policy "people staff read" on public.people
  for select using (
    public.is_club_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.team_managers tm
      where tm.person_id = people.id and public.manages_team(tm.team_id)
    )
  );
drop policy if exists "people admin all" on public.people;
create policy "people admin all" on public.people
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- -----------------------------------------------------------------------------
-- Development sessions: groups coaches can be put on, like teams, but not
-- listed on the public Teams pages. Sessions can be any day of the week.
-- -----------------------------------------------------------------------------
alter table public.teams
  add column if not exists kind text not null default 'team';
alter table public.teams drop constraint if exists teams_kind_check;
alter table public.teams add constraint teams_kind_check check (kind in ('team', 'development'));

alter table public.teams drop constraint if exists teams_match_day_check;
alter table public.teams add constraint teams_match_day_check
  check (match_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'));

create or replace function public.guard_team_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_club_admin() and (
       new.name is distinct from old.name
    or new.slug is distinct from old.slug
    or new.age_group is distinct from old.age_group
    or new.gender is distinct from old.gender
    or new.match_day is distinct from old.match_day
    or new.league is distinct from old.league
    or new.season is distinct from old.season
    or new.sort_order is distinct from old.sort_order
    or new.published is distinct from old.published
    or new.kind is distinct from old.kind
  ) then
    raise exception 'Only club admins can change a team''s name, age group, league or visibility';
  end if;
  return new;
end;
$$;

-- The public vacancies list needs to know which are for development sessions.
create or replace view public.vacancies_public as
  select v.id, v.team_id, v.kind, v.positions, v.spaces, v.experience,
         v.headline, v.description, v.contact_name,
         v.whatsapp_enabled, v.email_enabled, v.expires_on, v.created_at,
         t.name as team_name, t.slug as team_slug, t.age_group, t.gender,
         t.match_day, t.league, t.training, t.kind as team_kind
  from public.vacancies v
  join public.teams t on t.id = v.team_id
  where v.published
    and v.status = 'open'
    and t.published
    and (v.expires_on is null or v.expires_on >= (now() at time zone 'Europe/London')::date);
grant select on public.vacancies_public to anon, authenticated;

-- Start with one group for the Wednesday sessions; add more in the portal.
insert into public.teams (slug, name, age_group, kind, match_day, training, sort_order)
select 'development-sessions', 'Development sessions', '3+', 'development', 'Wednesday', 'Wednesdays 17:30–18:30', 5
where not exists (select 1 from public.teams where kind = 'development')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
