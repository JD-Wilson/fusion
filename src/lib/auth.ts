import type { SupabaseClient } from '@supabase/supabase-js';

/** A team (or development group) the signed-in person helps run. */
export interface MyTeam {
  id: string;
  name: string;
  slug: string;
  age_group: string;
  match_day: string | null;
  kind: 'team' | 'development';
  role_title: string;
}

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  isAdmin: boolean;
  /** Teams this person is on (admins can edit every team, and may coach some). */
  teamIds: string[];
  myTeams: MyTeam[];
}

const DAY_ORDER = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const dayRank = (day: string | null | undefined) => (day ? DAY_ORDER.indexOf(day) : 99);

/** The signed-in user's profile and teams, or null when signed out. */
export async function loadSession(supabase: SupabaseClient): Promise<Session | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: managed }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('team_managers').select('team_id, role_title, teams(*)').eq('user_id', user.id)
  ]);
  if (!profile) return null;

  type Row = { team_id: string; role_title: string; teams: Record<string, unknown> | null };
  const myTeams: MyTeam[] = ((managed ?? []) as unknown as Row[])
    .filter((m) => m.teams)
    .map((m) => ({
      id: m.team_id,
      name: String(m.teams!.name),
      slug: String(m.teams!.slug),
      age_group: String(m.teams!.age_group ?? ''),
      match_day: (m.teams!.match_day as string | null) ?? null,
      kind: (m.teams!.kind === 'development' ? 'development' : 'team') as MyTeam['kind'],
      role_title: m.role_title
    }))
    .sort((a, b) => dayRank(a.match_day) - dayRank(b.match_day) || a.name.localeCompare(b.name, 'en', { numeric: true }));

  return {
    userId: user.id,
    email: profile.email as string,
    fullName: (profile.full_name as string) ?? '',
    phone: (profile.phone as string | null) ?? null,
    isAdmin: profile.role === 'club_admin',
    teamIds: myTeams.map((t) => t.id),
    myTeams
  };
}

export const canEditTeam = (session: Session, teamId: string) =>
  session.isAdmin || session.teamIds.includes(teamId);

/** "Club admin", "Coach", or "Club admin · Coach" for an admin who also runs teams. */
export function roleLabel(session: Session): string {
  const runsTeams = session.myTeams.length > 0;
  if (session.isAdmin) return runsTeams ? 'Club admin · Coach' : 'Club admin';
  const titles = [...new Set(session.myTeams.map((t) => t.role_title))];
  return titles.length === 1 ? titles[0] : 'Coach';
}

/** Short day label for team lists: "Sat", "Sun", "Wed". */
export const shortDay = (day: string | null | undefined) => (day ? day.slice(0, 3) : '');
