import { publicSupabase } from './supabase';
import { ageNumber, getPublicVacancies, type PublicVacancy } from './vacancies';

/**
 * A team as the public sees it. Every column here is public; private contact
 * details live in `team_contacts` and are only read by the server.
 */
export interface PublicTeam {
  id: string;
  slug: string;
  name: string;
  age_group: string;
  gender: 'Boys' | 'Girls' | 'Mixed';
  match_day: 'Saturday' | 'Sunday' | null;
  league: string | null;
  season: string | null;
  training: string | null;
  training_venue: string | null;
  home_ground: string | null;
  description: string | null;
  photo_url: string | null;
  fulltime_url: string | null;
  /** Exact team name on FA Full-Time; links the page to fixtures and results. */
  fulltime_name?: string | null;
  contact_name: string | null;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  sort_order: number;
  /** 'development' groups are run like teams but don't get a public team page. */
  kind?: 'team' | 'development';
}

const isTeam = (t: PublicTeam) => (t.kind ?? 'team') === 'team';

/*
 * Every column on `teams` is public (private contact details live in
 * team_contacts), so select all: new columns then appear without breaking
 * pages before a migration has been run.
 */
const COLUMNS = '*';

const byAgeThenName = (a: PublicTeam, b: PublicTeam) =>
  ageNumber(a.age_group) - ageNumber(b.age_group) || a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** Published teams (RLS hides unpublished ones from the public). null = unavailable. */
export async function getPublicTeams(): Promise<PublicTeam[] | null> {
  const db = publicSupabase();
  if (!db) return null;
  const { data, error } = await db.from('teams').select(COLUMNS).eq('published', true);
  if (error) {
    console.error('[teams] load failed', error.message);
    return null;
  }
  return ((data ?? []) as PublicTeam[]).filter(isTeam).sort(byAgeThenName);
}

export async function getPublicTeam(slug: string): Promise<PublicTeam | null> {
  const db = publicSupabase();
  if (!db || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const { data, error } = await db.from('teams').select(COLUMNS).eq('slug', slug).eq('published', true).maybeSingle();
  if (error) console.error('[teams] load failed', error.message);
  const team = (data as PublicTeam | null) ?? null;
  return team && isTeam(team) ? team : null;
}

/** Open vacancies grouped by team id, so pages can flag teams that are recruiting. */
export async function getVacanciesByTeam(): Promise<Map<string, PublicVacancy[]>> {
  const list = (await getPublicVacancies()) ?? [];
  const map = new Map<string, PublicVacancy[]>();
  for (const v of list) map.set(v.team_id, [...(map.get(v.team_id) ?? []), v]);
  return map;
}

/** Club photo used when a team hasn't uploaded its own. */
export function teamPhoto(team: Pick<PublicTeam, 'photo_url' | 'gender' | 'age_group'>): string {
  if (team.photo_url) return team.photo_url;
  if (team.gender === 'Girls') return '/images/web/girls-session-evening.jpg';
  return ageNumber(team.age_group) <= 8 ? '/images/web/session-group-young.jpg' : '/images/web/players-training-bibs.jpg';
}

export const teamPath = (team: Pick<PublicTeam, 'slug'>) => `/teams/${team.slug}/`;

export function teamWhatsappMessage(team: Pick<PublicTeam, 'contact_name' | 'name' | 'age_group'>) {
  const first = (team.contact_name ?? '').replace(/^(coach|manager)\s+/i, '').split(' ')[0];
  const hi = first ? `Hi ${first}` : 'Hi';
  return `${hi}, I found ${team.name} (${team.age_group}) on the Fusion FC website and I'd like to find out more about the team.`;
}

/** Only fulltime.thefa.com links are allowed (managers paste them in). */
export function cleanFulltimeUrl(raw: string | null): string | null | false {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' && /(^|\.)fulltime\.thefa\.com$/i.test(url.hostname) ? url.toString() : false;
  } catch {
    return false;
  }
}

export interface PublicCoach {
  person_id: string;
  full_name: string;
  role_title: string;
  photo_url: string | null;
  bio: string | null;
  qualifications: string | null;
}

/** Coaches who chose to appear on their team's page (empty if none, or before migration 007). */
export async function getTeamCoaches(teamId: string): Promise<PublicCoach[]> {
  const db = publicSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from('team_coaches_public')
    .select('person_id, full_name, role_title, photo_url, bio, qualifications, sort_order')
    .eq('team_id', teamId)
    .order('sort_order')
    .order('full_name');
  if (error) return [];
  // Managers first, then coaches, assistants and helpers.
  const rank = (r: string) => ['Manager', 'Coach', 'Assistant coach', 'Helper'].indexOf(r) >>> 0;
  return (data as PublicCoach[]).sort((a, b) => rank(a.role_title) - rank(b.role_title));
}
