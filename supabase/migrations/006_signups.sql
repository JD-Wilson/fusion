-- 006: coaches sign themselves up; a club admin approves them.
--
-- Logins made by signing up on the website start unapproved: they can sign
-- in, but can't see or change anything until a club admin approves them in
-- People. (A sign-up is linked to the People entry with the same email, so
-- without this, anyone who knew a coach's email could take over their teams.)
-- Logins made by an admin are approved straight away. Safe to re-run.

alter table public.profiles add column if not exists approved boolean not null default true;
-- Existing logins were approved above. From now on a login starts unapproved
-- unless the portal approves it (admin-made logins are approved straight away),
-- so a login made any other way, e.g. directly through Supabase, can do nothing.
alter table public.profiles alter column approved set default false;

-- Unapproved logins have no permissions.
create or replace function public.is_club_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'club_admin' and approved
  );
$$;

create or replace function public.manages_team(t uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.team_managers tm
    join public.profiles p on p.id = tm.user_id
    where tm.team_id = t and tm.user_id = auth.uid() and p.approved
  );
$$;

-- Non-admins can't promote themselves, approve themselves or change their email.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_club_admin() then
    if new.role <> old.role then
      raise exception 'Only club admins can change roles';
    end if;
    if new.approved <> old.approved then
      raise exception 'Only club admins can approve logins';
    end if;
    if new.email <> old.email then
      raise exception 'Only club admins can change a profile email';
    end if;
  end if;
  return new;
end;
$$;

-- People: an unapproved login can't read the People entry it was linked to.
drop policy if exists "people staff read" on public.people;
create policy "people staff read" on public.people
  for select using (
    public.is_club_admin()
    or (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved))
    or exists (
      select 1 from public.team_managers tm
      where tm.person_id = people.id and public.manages_team(tm.team_id)
    )
  );

notify pgrst, 'reload schema';
