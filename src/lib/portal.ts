import type { SupabaseClient } from '@supabase/supabase-js';

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  age_group: string;
  gender: 'Boys' | 'Girls' | 'Mixed';
  match_day: 'Saturday' | 'Sunday' | null;
  league: string | null;
  season: string | null;
  training: string | null;
  description: string | null;
  sort_order: number;
  published: boolean;
  photo_url: string | null;
  training_venue: string | null;
  home_ground: string | null;
  fulltime_url: string | null;
  fulltime_name?: string | null;
  contact_name: string | null;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
}

/** RLS decides what's returned: admins get every team, managers only their own. */
export async function loadTeams(supabase: SupabaseClient, onlyManaged?: string[]): Promise<TeamRow[]> {
  let query = supabase.from('teams').select('*').order('sort_order').order('name');
  if (onlyManaged) query = query.in('id', onlyManaged.length ? onlyManaged : ['00000000-0000-0000-0000-000000000000']);
  const { data } = await query;
  return (data ?? []) as TeamRow[];
}

export async function countNewEnquiries(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('enquiries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');
  return count ?? 0;
}

export const ukDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
