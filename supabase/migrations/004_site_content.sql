-- =============================================================================
-- 004 — Editable website content (2026-11-13)
-- Run in the Supabase SQL editor, then run supabase/seed-content.sql to copy
-- the current pages and blog posts in. Safe to re-run. Also in schema.sql.
--
-- Club admins edit these in the portal (Pages, Blog, Media). Pages and posts
-- without a row here fall back to the markdown files in src/content, so the
-- site keeps working before the import and if the database is unreachable.
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

notify pgrst, 'reload schema';
