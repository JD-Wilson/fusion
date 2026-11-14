import type { SupabaseClient } from '@supabase/supabase-js';
import { dayRank } from './auth';
import { fromOurSide, fulltimeNameFor, hasFulltimeData, kickOff, shortName, upcomingFixtures, venueOf } from './matches';
import type { TeamRow } from './portal';
import type { VacancyRow } from './portal-vacancies';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

export const isLive = (v: Pick<VacancyRow, 'status' | 'published' | 'expires_on'>) =>
  v.status === 'open' && v.published && (!v.expires_on || v.expires_on >= today());

/** Days from today until a date (negative once it has passed). */
export function daysUntil(date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86_400_000);
}

/** What a team page still needs, in the order a coach would fix it. */
export function pageChecklist(team: TeamRow) {
  const items = [
    { label: 'Team photo', done: Boolean(team.photo_url) },
    { label: 'About the team', done: Boolean(team.description?.trim()) },
    { label: 'Training times', done: Boolean(team.training?.trim()) },
    { label: 'Contact name for parents', done: Boolean(team.contact_name?.trim()) },
    ...(team.kind !== 'development' && hasFulltimeData
      ? [{ label: 'Linked to Full-Time', done: Boolean(fulltimeNameFor(team)) }]
      : [])
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, missing: items.filter((i) => !i.done).map((i) => i.label) };
}

/** "Sat 21 Nov, 10:00 v Hanley Town (home)" for the team's next game, if Full-Time has one. */
export function nextGame(team: TeamRow): { when: string; text: string } | null {
  const name = team.kind === 'development' ? null : fulltimeNameFor(team);
  if (!name) return null;
  const [m] = upcomingFixtures({ team: name, limit: 1 });
  if (!m) return null;
  const side = fromOurSide(m, name);
  const date = new Date(`${m.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = kickOff(m);
  const venue = venueOf(m);
  return {
    when: [date, time].filter(Boolean).join(', '),
    text: `v ${shortName(side.them.name)} (${side.home ? 'home' : 'away'})${venue && !side.home ? `, ${venue}` : ''}`
  };
}

/** Saturday teams, then Sunday, then midweek groups; age order within each. */
export function sortTeams<T extends Pick<TeamRow, 'name' | 'match_day' | 'kind'>>(teams: T[]): T[] {
  return [...teams].sort(
    (a, b) =>
      Number(a.kind === 'development') - Number(b.kind === 'development') ||
      dayRank(a.match_day) - dayRank(b.match_day) ||
      a.name.localeCompare(b.name, 'en', { numeric: true })
  );
}

/** Group label for a team: "Saturday", "Sunday", "Development sessions" or "Day not set". */
export const groupOf = (t: Pick<TeamRow, 'match_day' | 'kind'>) =>
  t.kind === 'development' ? 'Development sessions' : t.match_day ?? 'Day not set';

export interface TeamStats {
  live: number;
  newEnquiries: number;
  coaches: string[];
}

/** Live vacancies, new enquiries and coach names per team. RLS limits rows to what the user may see. */
export async function teamStats(supabase: SupabaseClient, teamIds?: string[]): Promise<Map<string, TeamStats>> {
  const ids = teamIds?.length ? teamIds : teamIds ? ['00000000-0000-0000-0000-000000000000'] : null;
  const vacancyQuery = supabase.from('vacancies').select('team_id, status, published, expires_on');
  const enquiryQuery = supabase.from('enquiries').select('team_id').eq('status', 'new');
  const managerQuery = supabase.from('team_managers').select('team_id, display_name, sort_order').order('sort_order');
  const [{ data: vacancies }, { data: enquiries }, { data: managers }] = await Promise.all([
    ids ? vacancyQuery.in('team_id', ids) : vacancyQuery,
    ids ? enquiryQuery.in('team_id', ids) : enquiryQuery,
    ids ? managerQuery.in('team_id', ids) : managerQuery
  ]);
  const stats = new Map<string, TeamStats>();
  const get = (id: string) => {
    if (!stats.has(id)) stats.set(id, { live: 0, newEnquiries: 0, coaches: [] });
    return stats.get(id)!;
  };
  for (const v of (vacancies ?? []) as Pick<VacancyRow, 'team_id' | 'status' | 'published' | 'expires_on'>[]) if (isLive(v)) get(v.team_id).live++;
  for (const e of (enquiries ?? []) as { team_id: string | null }[]) if (e.team_id) get(e.team_id).newEnquiries++;
  for (const m of (managers ?? []) as { team_id: string; display_name: string }[]) get(m.team_id).coaches.push(m.display_name);
  return stats;
}
