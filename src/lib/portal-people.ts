import type { SupabaseClient } from '@supabase/supabase-js';
import { EMAIL, UUID, checked, line, text } from './forms';
import { adminSupabase } from './supabase';
import { normaliseWhatsApp } from './vacancies';

/** Roles a person can have on a team (free text in the database). */
export const TEAM_ROLES = ['Manager', 'Coach', 'Assistant coach', 'Helper'];

/** What a person can do in the portal. */
export type Access = 'none' | 'coach' | 'admin';

export interface PersonTeam {
  id: string; // team_managers row
  team_id: string;
  role_title: string;
  receives_enquiries: boolean;
  teams: { name: string; age_group: string; match_day: string | null } | null;
}

export interface Person {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  user_id: string | null;
  profiles: { role: 'club_admin' | 'team_manager' } | null;
  team_managers: PersonTeam[];
}

const PERSON_SELECT =
  'id, full_name, email, phone, notes, user_id, profiles(role), team_managers(id, team_id, role_title, receives_enquiries, teams(name, age_group, match_day))';

export const accessOf = (p: Pick<Person, 'user_id' | 'profiles'>): Access =>
  !p.user_id ? 'none' : p.profiles?.role === 'club_admin' ? 'admin' : 'coach';

export async function loadPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data } = await supabase.from('people').select(PERSON_SELECT).order('full_name');
  return (data ?? []) as unknown as Person[];
}

export async function loadPerson(supabase: SupabaseClient, id: string): Promise<Person | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabase.from('people').select(PERSON_SELECT).eq('id', id).maybeSingle();
  return (data as unknown as Person) ?? null;
}

/** Logins that have signed in at least once, from Supabase Auth. */
export async function signedInUserIds(): Promise<Set<string>> {
  const admin = adminSupabase();
  if (!admin) return new Set();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return new Set((data?.users ?? []).filter((u) => u.last_sign_in_at).map((u) => u.id));
}

export interface PersonValues {
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface Assignment {
  team_id: string;
  role_title: string;
  receives_enquiries: boolean;
}

/** The person form: details, teams (with a role on each) and access. */
export function parsePersonForm(form: FormData):
  | { error: string; values?: undefined }
  | { error?: undefined; values: PersonValues; teams: Assignment[]; access: Access } {
  const full_name = line(form, 'full_name', 80);
  if (!full_name) return { error: 'Please enter their name.' };
  const email = line(form, 'email', 200)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) return { error: "That email address doesn't look right." };
  const phone = line(form, 'phone', 30);
  if (phone && !normaliseWhatsApp(phone)) return { error: "That mobile number doesn't look right." };

  const raw = String(form.get('access') ?? 'none');
  const access: Access = raw === 'admin' || raw === 'coach' ? raw : 'none';
  if (access !== 'none' && !email) return { error: 'A login needs an email address.' };

  const teams = form
    .getAll('team')
    .map(String)
    .filter((id) => UUID.test(id))
    .map((team_id) => {
      const role = line(form, `role_${team_id}`, 40);
      return {
        team_id,
        role_title: role && TEAM_ROLES.includes(role) ? role : 'Coach',
        receives_enquiries: checked(form, `enquiries_${team_id}`)
      };
    });

  return { values: { full_name, email, phone, notes: text(form, 'notes', 1000) }, teams, access };
}

/** What was typed, to put back on screen when the form has a problem. */
export function draftFromForm(form: FormData): Partial<Person> {
  const value = (key: string) => String(form.get(key) ?? '');
  return {
    full_name: value('full_name'),
    email: value('email'),
    phone: value('phone'),
    notes: value('notes'),
    team_managers: form.getAll('team').map((id) => ({
      id: '',
      team_id: String(id),
      role_title: value(`role_${id}`) || 'Coach',
      receives_enquiries: checked(form, `enquiries_${id}`),
      teams: null
    }))
  };
}

/** Make the person's teams match the form: add, update and remove. */
export async function saveAssignments(supabase: SupabaseClient, personId: string, wanted: Assignment[]) {
  const { data } = await supabase.from('team_managers').select('id, team_id').eq('person_id', personId);
  const current = (data ?? []) as { id: string; team_id: string }[];
  const keep = new Set(wanted.map((a) => a.team_id));
  const gone = current.filter((c) => !keep.has(c.team_id)).map((c) => c.id);
  if (gone.length) {
    const { error } = await supabase.from('team_managers').delete().in('id', gone);
    if (error) return error;
  }
  for (const a of wanted) {
    const existing = current.find((c) => c.team_id === a.team_id);
    const { error } = existing
      ? await supabase.from('team_managers').update({ role_title: a.role_title, receives_enquiries: a.receives_enquiries }).eq('id', existing.id)
      : await supabase.from('team_managers').insert({ ...a, person_id: personId, display_name: '' });
    if (error) return error;
  }
  return null;
}

/**
 * Give a person the access chosen on the form. A first login sends an invite
 * email; if a login with their email already exists it is linked instead.
 * Returns a note for the admin, or an error.
 */
export async function applyAccess(
  person: { id: string; email: string | null; full_name: string; user_id: string | null },
  access: Access,
  origin: string
): Promise<{ note?: string; error?: string }> {
  const admin = adminSupabase();
  if (!admin) return access === 'none' ? {} : { error: 'Logins need SUPABASE_SERVICE_ROLE_KEY to be set on the server.' };
  const role = access === 'admin' ? 'club_admin' : 'team_manager';

  if (access === 'none') {
    if (!person.user_id) return {};
    const { error } = await admin.auth.admin.deleteUser(person.user_id);
    return error ? { error: error.message } : { note: 'Their login has been removed. They stay on their teams.' };
  }

  let userId = person.user_id;
  let note: string | undefined;
  if (!userId) {
    const { data: existing } = await admin.from('profiles').select('id').eq('email', person.email!.toLowerCase()).maybeSingle();
    if (existing) {
      userId = existing.id as string;
      const { error } = await admin.from('people').update({ user_id: userId }).eq('id', person.id);
      if (error) return { error: error.code === '23505' ? 'That login already belongs to someone else in People.' : error.message };
      note = 'Linked to their existing login.';
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(person.email!, {
        data: { full_name: person.full_name },
        redirectTo: `${origin}/auth/confirm/?next=/portal/account/`
      });
      if (error || !data.user) return { error: error?.message ?? 'The invite could not be sent.' };
      userId = data.user.id;
      // The database links the new login to this person by email; make sure.
      await admin.from('people').update({ user_id: userId }).eq('id', person.id).is('user_id', null);
      note = `Invite sent to ${person.email}. They sign in from the link in the email.`;
    }
  }
  const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
  return error ? { error: error.message } : { note };
}
