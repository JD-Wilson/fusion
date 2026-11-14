-- =============================================================================
-- Fusion FC: Supabase schema
-- Run once in the Supabase SQL editor (Project → SQL → New query), then run
-- supabase/seed.sql. Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Roles
--   club_admin    Club leadership. Full control of teams, vacancies, people.
--   team_manager  Manages the teams they're assigned to: team details,
--                 vacancies for those teams, and enquiries about them.
--
-- Public (parents, no login) can only read published teams and the
-- `vacancies_public` view. Managers' WhatsApp numbers are NEVER readable by
-- the public API: they live in `vacancy_contacts`, which only staff can read,
-- and the website's server looks the number up when a parent taps WhatsApp.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profiles (one per auth user)
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('club_admin', 'team_manager');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role public.user_role not null default 'team_manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- New users always start as team_manager. Role is never taken from signup
-- metadata, so nobody can make themselves an admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_club_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'club_admin'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Teams
-- -----------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  age_group text not null,                -- "U7" … "U18"
  gender text not null default 'Mixed' check (gender in ('Boys', 'Girls', 'Mixed')),
  match_day text check (match_day in ('Saturday', 'Sunday')),
  league text,
  season text,
  training text,                          -- free text, e.g. "Tuesdays 6pm at the Rec"
  description text,
  sort_order int not null default 100,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before update on public.teams
  for each row execute function public.touch_updated_at();

-- A manager can be listed by name before they have a login; link the login
-- later (user_id). Only linked managers can edit the team and read enquiries.
create table if not exists public.team_managers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  role_title text not null default 'Manager',
  receives_enquiries boolean not null default true,
  sort_order int not null default 100
);
create unique index if not exists team_managers_team_user
  on public.team_managers (team_id, user_id) where user_id is not null;

create or replace function public.manages_team(t uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_managers where team_id = t and user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Vacancies: a team looking for a player (or a coach / helper)
-- -----------------------------------------------------------------------------
create table if not exists public.vacancies (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null default 'player' check (kind in ('player', 'coach')),
  -- Positions wanted. Empty array means "any position".
  positions text[] not null default '{}',
  spaces int not null default 1 check (spaces between 1 and 20),
  experience text not null default 'any'
    check (experience in ('any', 'beginner', 'some', 'experienced')),
  headline text,                          -- optional, e.g. "Goalkeeper needed!"
  description text,
  contact_name text not null,             -- shown publicly, e.g. "Coach Mark"
  -- Visible to the public as a boolean only. The number itself is private.
  whatsapp_enabled boolean not null default false,
  email_enabled boolean not null default true,
  status text not null default 'open' check (status in ('open', 'filled')),
  published boolean not null default true,
  expires_on date,                        -- hidden automatically after this day
  whatsapp_clicks int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vacancies_team_idx on public.vacancies (team_id);

drop trigger if exists vacancies_touch on public.vacancies;
create trigger vacancies_touch before update on public.vacancies
  for each row execute function public.touch_updated_at();

-- Private contact details for a vacancy (one row per vacancy). Staff only.
create table if not exists public.vacancy_contacts (
  vacancy_id uuid primary key references public.vacancies (id) on delete cascade,
  whatsapp_number text,                   -- international digits only, e.g. 447700900123
  email text                              -- where enquiries go; defaults to the manager's login email
);

-- What the public sees: open, published, unexpired vacancies on published
-- teams. No phone numbers or emails. (A view runs with its owner's rights, so
-- it can be read even though the tables behind it are not public.)
create or replace view public.vacancies_public as
  select v.id, v.team_id, v.kind, v.positions, v.spaces, v.experience,
         v.headline, v.description, v.contact_name,
         v.whatsapp_enabled, v.email_enabled, v.expires_on, v.created_at,
         t.name as team_name, t.slug as team_slug, t.age_group, t.gender,
         t.match_day, t.league, t.training
  from public.vacancies v
  join public.teams t on t.id = v.team_id
  where v.published
    and v.status = 'open'
    and t.published
    and (v.expires_on is null or v.expires_on >= (now() at time zone 'Europe/London')::date);

grant select on public.vacancies_public to anon, authenticated;

-- Counts a WhatsApp tap. Only the website's server (service role) may call it.
create or replace function public.bump_vacancy_clicks(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.vacancies set whatsapp_clicks = whatsapp_clicks + 1 where id = p_id;
$$;
revoke all on function public.bump_vacancy_clicks(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Club settings (single row) and private settings
-- -----------------------------------------------------------------------------
create table if not exists public.club_settings (
  id int primary key default 1 check (id = 1),
  announcement text,
  updated_at timestamptz not null default now()
);
insert into public.club_settings (id) values (1) on conflict do nothing;

-- Admins only: where general enquiries go when a vacancy has no manager email.
create table if not exists public.club_private (
  id int primary key default 1 check (id = 1),
  inbox_email text,
  updated_at timestamptz not null default now()
);
insert into public.club_private (id) values (1) on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Enquiries (parent → manager, saved so nothing gets lost)
-- -----------------------------------------------------------------------------
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  team_id uuid references public.teams (id) on delete set null,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  player_name text,
  player_age text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'replied', 'closed')),
  emailed_to text[]
);
create index if not exists enquiries_team_idx on public.enquiries (team_id);
create index if not exists enquiries_created_idx on public.enquiries (created_at desc);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_managers enable row level security;
alter table public.vacancies enable row level security;
alter table public.vacancy_contacts enable row level security;
alter table public.club_settings enable row level security;
alter table public.club_private enable row level security;
alter table public.enquiries enable row level security;

-- Profiles: you can see/edit yourself; admins see/edit everyone.
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_club_admin());
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid() or public.is_club_admin());

-- Stop non-admins promoting themselves or changing their email. Requests with
-- no signed-in user (SQL editor, service-role key) are trusted, which is how
-- the first club admin is set up.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_club_admin() then
    if new.role <> old.role then
      raise exception 'Only club admins can change roles';
    end if;
    if new.email <> old.email then
      raise exception 'Only club admins can change a profile email';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Teams: public reads published; managers update their own; admins do anything.
drop policy if exists "teams public read" on public.teams;
create policy "teams public read" on public.teams
  for select using (published or public.is_club_admin() or public.manages_team(id));
drop policy if exists "teams manager update" on public.teams;
create policy "teams manager update" on public.teams
  for update using (public.manages_team(id)) with check (public.manages_team(id));
drop policy if exists "teams admin all" on public.teams;
create policy "teams admin all" on public.teams
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- Managers may change only a team's day-to-day details.
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
  ) then
    raise exception 'Only club admins can change a team''s name, age group, league or visibility';
  end if;
  return new;
end;
$$;
drop trigger if exists teams_guard_fields on public.teams;
create trigger teams_guard_fields before update on public.teams
  for each row execute function public.guard_team_fields();

-- Team managers: staff see who manages what; only admins change assignments.
-- (Not public: the public site shows manager names via vacancies, not this table.)
drop policy if exists "team_managers staff read" on public.team_managers;
create policy "team_managers staff read" on public.team_managers
  for select using (public.is_club_admin() or user_id = auth.uid() or public.manages_team(team_id));
drop policy if exists "team_managers admin all" on public.team_managers;
create policy "team_managers admin all" on public.team_managers
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- Vacancies: staff only on the raw table (the public uses vacancies_public).
-- Managers create/edit/delete vacancies for their own teams only.
drop policy if exists "vacancies staff read" on public.vacancies;
create policy "vacancies staff read" on public.vacancies
  for select using (public.is_club_admin() or public.manages_team(team_id));
drop policy if exists "vacancies staff insert" on public.vacancies;
create policy "vacancies staff insert" on public.vacancies
  for insert with check (public.is_club_admin() or public.manages_team(team_id));
drop policy if exists "vacancies staff update" on public.vacancies;
create policy "vacancies staff update" on public.vacancies
  for update using (public.is_club_admin() or public.manages_team(team_id))
  with check (public.is_club_admin() or public.manages_team(team_id));
drop policy if exists "vacancies staff delete" on public.vacancies;
create policy "vacancies staff delete" on public.vacancies
  for delete using (public.is_club_admin() or public.manages_team(team_id));

-- A manager must not be able to move a vacancy onto someone else's team or
-- reset its counters.
create or replace function public.guard_vacancy_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id and not public.is_club_admin() then
      raise exception 'Only club admins can move a vacancy to another team';
    end if;
    new.whatsapp_clicks = old.whatsapp_clicks;
  end if;
  return new;
end;
$$;
drop trigger if exists vacancies_guard on public.vacancies;
create trigger vacancies_guard before update on public.vacancies
  for each row execute function public.guard_vacancy_fields();

drop policy if exists "vacancy_contacts staff all" on public.vacancy_contacts;
create policy "vacancy_contacts staff all" on public.vacancy_contacts
  for all using (
    exists (select 1 from public.vacancies v
            where v.id = vacancy_id and (public.is_club_admin() or public.manages_team(v.team_id)))
  ) with check (
    exists (select 1 from public.vacancies v
            where v.id = vacancy_id and (public.is_club_admin() or public.manages_team(v.team_id)))
  );

-- Settings: public read (announcement), admin write. Private: admin only.
drop policy if exists "settings public read" on public.club_settings;
create policy "settings public read" on public.club_settings for select using (true);
drop policy if exists "settings admin all" on public.club_settings;
create policy "settings admin all" on public.club_settings
  for all using (public.is_club_admin()) with check (public.is_club_admin());
drop policy if exists "club private admin all" on public.club_private;
create policy "club private admin all" on public.club_private
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- Enquiries: written only by the website's server (service role bypasses RLS),
-- so its spam checks can't be skipped. Admins see all; managers their teams'.
drop policy if exists "enquiries staff read" on public.enquiries;
create policy "enquiries staff read" on public.enquiries
  for select using (public.is_club_admin() or (team_id is not null and public.manages_team(team_id)));
drop policy if exists "enquiries staff update" on public.enquiries;
create policy "enquiries staff update" on public.enquiries
  for update using (public.is_club_admin() or (team_id is not null and public.manages_team(team_id)));
drop policy if exists "enquiries admin delete" on public.enquiries;
create policy "enquiries admin delete" on public.enquiries
  for delete using (public.is_club_admin());

-- =============================================================================
-- Team pages (also in supabase/migrations/002_team_pages.sql)
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

-- =============================================================================
-- FA Full-Time link (also in supabase/migrations/003_fulltime.sql)
-- =============================================================================
alter table public.teams add column if not exists fulltime_name text;

-- =============================================================================
-- Editable website content (also in supabase/migrations/004_site_content.sql)
-- =============================================================================

-- Pages: the core pages (about, join, contact…) and club information pages
-- (values, guides, codes of conduct, policies) shown under /club/<slug>/.
create table if not exists public.site_pages (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  title text not null,
  description text not null default '',  -- the summary under the page title
  body text not null default '',         -- markdown
  nav_label text,                        -- club pages: short name in menus
  show_in_nav boolean not null default false,
  sort_order int not null default 100,
  hero_image text,                       -- replaces the page's default photo
  attachment_url text,                   -- e.g. a PDF copy of a policy
  attachment_label text,
  seo_title text,
  seo_description text,
  noindex boolean not null default false,
  published boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

drop trigger if exists site_pages_touch on public.site_pages;
create trigger site_pages_touch before update on public.site_pages
  for each row execute function public.touch_updated_at();

-- Which pages exist and whether they're published, without their content, so
-- the site can hide a page an admin has unpublished (instead of falling back
-- to its markdown file).
create or replace view public.site_page_states as
  select slug, published from public.site_pages;
grant select on public.site_page_states to anon, authenticated;

-- Blog posts.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null,
  date date not null default (now() at time zone 'Europe/London')::date,
  excerpt text not null default '',
  body text not null default '',         -- markdown
  cover_image text,
  tags text[] not null default '{}',
  author text not null default 'Fusion Football Club',
  draft boolean not null default true,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists posts_date_idx on public.posts (draft, date desc);

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

alter table public.site_pages enable row level security;
alter table public.posts enable row level security;

drop policy if exists "site_pages public read" on public.site_pages;
create policy "site_pages public read" on public.site_pages
  for select using (published or public.is_club_admin());
drop policy if exists "site_pages admin all" on public.site_pages;
create policy "site_pages admin all" on public.site_pages
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- Posts go live once not a draft and their date has arrived (so they can be scheduled).
drop policy if exists "posts public read" on public.posts;
create policy "posts public read" on public.posts
  for select using (
    (not draft and date <= (now() at time zone 'Europe/London')::date) or public.is_club_admin()
  );
drop policy if exists "posts admin all" on public.posts;
create policy "posts admin all" on public.posts
  for all using (public.is_club_admin()) with check (public.is_club_admin());

-- -----------------------------------------------------------------------------
-- Media: photos and documents for pages and posts. Public to read; only club
-- admins can upload or delete.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site-media public read" on storage.objects;
create policy "site-media public read" on storage.objects
  for select using (bucket_id = 'site-media');
drop policy if exists "site-media admin write" on storage.objects;
create policy "site-media admin write" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-media' and public.is_club_admin())
  with check (bucket_id = 'site-media' and public.is_club_admin());

-- =============================================================================
-- People (also in supabase/migrations/005_people.sql)
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
