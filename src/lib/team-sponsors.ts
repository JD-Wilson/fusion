import type { SupabaseClient } from '@supabase/supabase-js';
import { line, text } from './forms';
import { publicSupabase } from './supabase';

/** A team's sponsor (migration 008). Shown on the team's public page. */
export interface TeamSponsor {
  id: string;
  team_id: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  blurb: string | null;
  sort_order: number;
}

const COLUMNS = 'id, team_id, name, website, logo_url, blurb, sort_order';
const BUCKET = 'team-photos';
const LOGO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_LOGO = 2 * 1024 * 1024;

/** Sponsors of a published team, for its public page (empty before migration 008). */
export async function getTeamSponsors(teamId: string): Promise<TeamSponsor[]> {
  const db = publicSupabase();
  if (!db) return [];
  const { data, error } = await db.from('team_sponsors').select(COLUMNS).eq('team_id', teamId).order('sort_order').order('created_at');
  return error ? [] : (data as TeamSponsor[]);
}

/** A team's sponsors for the portal. `ready` is false until migration 008 has been run. */
export async function loadSponsorsForPortal(supabase: SupabaseClient, teamId: string): Promise<{ sponsors: TeamSponsor[]; ready: boolean }> {
  const { data, error } = await supabase.from('team_sponsors').select(COLUMNS).eq('team_id', teamId).order('sort_order').order('created_at');
  return { sponsors: (data ?? []) as TeamSponsor[], ready: !error };
}

/** "example.co.uk" → "https://example.co.uk/". Only http(s) links; false if it isn't a web address. */
export function cleanWebsite(raw: string | null): string | null | false {
  if (!raw) return null;
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return false;
    return url.toString();
  } catch {
    return false;
  }
}

/** "example.co.uk" for showing a sponsor's link. */
export const websiteLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function parseSponsorForm(form: FormData):
  | { error: string; values?: undefined }
  | { error?: undefined; values: { name: string; website: string | null; blurb: string | null; sort_order: number } } {
  const name = line(form, 'sponsor_name', 80);
  if (!name) return { error: "Please enter the sponsor's name." };
  const website = cleanWebsite(line(form, 'sponsor_website', 300));
  if (website === false) return { error: "That website address doesn't look right. Try something like www.example.co.uk." };
  const order = Number.parseInt(String(form.get('sponsor_order') ?? ''), 10);
  return {
    values: {
      name,
      website,
      blurb: text(form, 'sponsor_blurb', 300),
      sort_order: Number.isFinite(order) ? Math.min(Math.max(order, 0), 999) : 100
    }
  };
}

/**
 * Upload a sponsor logo to team-photos as <team_id>/sponsors/<time>.<ext>.
 * Storage policies only let that team's managers and club admins write there.
 * Returns the public URL, null when no file was chosen, or an error.
 */
export async function uploadSponsorLogo(
  supabase: SupabaseClient,
  teamId: string,
  file: FormDataEntryValue | null
): Promise<{ url: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { url: null };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { url: null, error: 'Please use a PNG, JPEG or WebP logo.' };
  if (file.size > MAX_LOGO) return { url: null, error: 'That logo is over 2MB. Please choose a smaller one.' };
  const path = `${teamId}/sponsors/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (error) return { url: null, error: `Upload failed: ${error.message}` };
  return { url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}

/** Remove an old logo file once it's been replaced or its sponsor deleted. */
export async function removeSponsorLogo(supabase: SupabaseClient, url: string | null | undefined) {
  const path = url?.split(`/${BUCKET}/`)[1];
  if (path && path.includes('/sponsors/')) await supabase.storage.from(BUCKET).remove([decodeURIComponent(path)]);
}
