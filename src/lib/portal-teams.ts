import type { SupabaseClient } from '@supabase/supabase-js';
import { EMAIL, checked, line, slugify, text } from './forms';
import { fulltimeTeamDraft, fulltimeTeams } from './matches';
import { cleanFulltimeUrl } from './teams';
import { normaliseWhatsApp } from './vacancies';

const GENDERS = ['Boys', 'Girls', 'Mixed'];
export const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** Identity fields: club admins only (the database trigger enforces the same split). */
export function parseAdminTeamFields(form: FormData) {
  const name = line(form, 'name', 80);
  const age_group = line(form, 'age_group', 10)?.toUpperCase();
  if (!name || !age_group) return { error: 'Team name and age group are needed.' };
  const gender = text(form, 'gender');
  const day = text(form, 'match_day');
  const kind = form.get('kind') === 'development' ? 'development' : 'team';
  return {
    values: {
      kind,
      name,
      age_group,
      gender: gender && GENDERS.includes(gender) ? gender : 'Mixed',
      match_day: day && DAYS.includes(day) ? day : null,
      league: kind === 'team' ? line(form, 'league', 120) : null,
      season: kind === 'team' ? line(form, 'season', 20) : null,
      published: checked(form, 'published')
    }
  };
}

export const newTeamSlug = (name: string, day: string | null) => slugify(`${day === 'Saturday' ? 'sat' : day === 'Sunday' ? 'sun' : ''} ${name}`);

/** Insert a team, adding -2, -3… to the address if another team already has it. */
export async function insertTeam(supabase: SupabaseClient, values: Record<string, unknown> & { name: string; match_day: string | null }) {
  const base = newTeamSlug(values.name, values.match_day);
  for (let n = 1; n <= 5; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const result = await supabase.from('teams').insert({ ...values, slug }).select('id').single();
    if (result.error?.code !== '23505' || !/slug/.test(result.error.message)) return result;
  }
  return { data: null, error: { code: '23505', message: 'A team with that name already exists.' } };
}

/** A hidden team made from a Full-Time team, linked to its fixtures. */
export async function createTeamFromFulltime(supabase: SupabaseClient, fulltimeName: string) {
  const draft = fulltimeTeamDraft(fulltimeName);
  if (!draft) return { data: null, error: { code: '', message: 'That team is no longer on Full-Time.' } };
  const { fulltimeName: fulltime_name, ...rest } = draft;
  return insertTeam(supabase, { ...rest, age_group: rest.age_group || 'U?', fulltime_name, published: false, kind: 'team' });
}

/** Day-to-day details any of the team's managers may change. */
export function parseManagerTeamFields(form: FormData) {
  const fulltime = cleanFulltimeUrl(text(form, 'fulltime_url', 300));
  if (fulltime === false) return { error: 'The Full-Time link must be a fulltime.thefa.com address.' };

  const whatsapp_enabled = checked(form, 'whatsapp_enabled');
  const email_enabled = checked(form, 'email_enabled');
  const whatsapp_number = normaliseWhatsApp(text(form, 'whatsapp_number', 30));
  const contact_email = line(form, 'contact_email', 200)?.toLowerCase() ?? null;

  if (whatsapp_enabled && !whatsapp_number) {
    return { error: "That WhatsApp number doesn't look right. Use a mobile number like 07700 900123." };
  }
  if (whatsapp_enabled && !checked(form, 'consent')) {
    return { error: 'Please confirm you are happy for parents to see this number in WhatsApp.' };
  }
  if (contact_email && !EMAIL.test(contact_email)) return { error: "That contact email doesn't look right." };

  // Must match a Full-Time team name exactly, once the first snapshot exists.
  const fulltime_name = line(form, 'fulltime_name', 120);
  if (fulltime_name && fulltimeTeams.length && !fulltimeTeams.includes(fulltime_name)) {
    return { error: 'Choose the team’s name from the Full-Time list so its fixtures can be found.' };
  }

  return {
    values: {
      description: text(form, 'description', 1500),
      training: line(form, 'training', 160),
      training_venue: line(form, 'training_venue', 120),
      home_ground: line(form, 'home_ground', 120),
      fulltime_url: fulltime,
      fulltime_name,
      contact_name: line(form, 'contact_name', 80),
      whatsapp_enabled,
      email_enabled
    },
    // Keep a stored number even when WhatsApp is switched off, so it can be turned back on.
    contact: { whatsapp_number, email: contact_email }
  };
}

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO = 5 * 1024 * 1024;

/**
 * Upload a team photo to the `team-photos` bucket as <team_id>/<time>.<ext>.
 * Storage policies only let admins and that team's managers write there.
 * Returns the public URL, null when no file was chosen, or an error.
 */
export async function uploadTeamPhoto(
  supabase: SupabaseClient,
  teamId: string,
  file: FormDataEntryValue | null
): Promise<{ url: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { url: null };
  const ext = PHOTO_TYPES[file.type];
  if (!ext) return { url: null, error: 'Please use a JPEG, PNG or WebP photo.' };
  if (file.size > MAX_PHOTO) return { url: null, error: 'That photo is over 5MB. Please choose a smaller one.' };

  const path = `${teamId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('team-photos').upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) return { url: null, error: `Upload failed: ${error.message}` };
  return { url: supabase.storage.from('team-photos').getPublicUrl(path).data.publicUrl };
}

export async function saveTeamContact(
  supabase: SupabaseClient,
  teamId: string,
  contact: { whatsapp_number: string | null; email: string | null }
) {
  return supabase.from('team_contacts').upsert({ team_id: teamId, ...contact });
}
