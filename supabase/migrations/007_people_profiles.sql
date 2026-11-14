-- 007: profile photos and "Meet the coaches".
--
-- Everyone in People can have a photo, an "About me" line and qualifications.
-- They only appear on the public team pages if "Show me on my team pages" is
-- ticked. Photos are uploaded through the website's server, which checks who
-- is uploading, so the bucket only needs public read. Safe to re-run.

alter table public.people add column if not exists photo_url text;
alter table public.people add column if not exists bio text;
alter table public.people add column if not exists qualifications text;
alter table public.people add column if not exists show_on_site boolean not null default false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('people-photos', 'people-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "people-photos public read" on storage.objects;
create policy "people-photos public read" on storage.objects
  for select using (bucket_id = 'people-photos');

-- The coaches parents can see: only people who opted in, on published teams.
-- No emails or phone numbers. (A view runs with its owner's rights.)
create or replace view public.team_coaches_public as
  select tm.team_id, p.id as person_id, p.full_name, tm.role_title,
         p.photo_url, p.bio, p.qualifications, tm.sort_order
  from public.team_managers tm
  join public.people p on p.id = tm.person_id
  join public.teams t on t.id = tm.team_id
  where p.show_on_site and t.published;

grant select on public.team_coaches_public to anon, authenticated;

notify pgrst, 'reload schema';
