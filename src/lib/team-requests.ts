import { line } from './forms';
import { TEAM_ROLES } from './portal-people';
import { adminSupabase } from './supabase';

/*
 * When coaches sign up they say which teams they help with and their role.
 * That's only a note for the club admin who approves them: it gives no access.
 * It's kept on their login (Supabase Auth user metadata), so no table is needed.
 */
export interface TeamRequest {
  team_id: string;
  role: string;
}

export interface SignupRequest {
  teams: TeamRequest[];
  /** "Team not listed / anything else". */
  other: string | null;
}

/** The teams ticked on the sign-up form, limited to real teams and known roles. */
export function parseSignupRequest(form: FormData, teamIds: Set<string>): SignupRequest {
  const teams = form
    .getAll('team')
    .map(String)
    .filter((id) => teamIds.has(id))
    .map((team_id) => {
      const role = line(form, `role_${team_id}`, 40);
      return { team_id, role: role && TEAM_ROLES.includes(role) ? role : 'Coach' };
    });
  return { teams, other: line(form, 'teams_other', 300) };
}

/** What someone asked for when they signed up, or null if nothing was given. */
export async function loadSignupRequest(userId: string): Promise<SignupRequest | null> {
  const admin = adminSupabase();
  if (!admin) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  const meta = data.user?.user_metadata ?? {};
  const teams = Array.isArray(meta.requested_teams)
    ? (meta.requested_teams as unknown[])
        .filter((t): t is TeamRequest => typeof t === 'object' && t !== null && typeof (t as TeamRequest).team_id === 'string')
        .map((t) => ({ team_id: t.team_id, role: String(t.role ?? 'Coach') }))
    : [];
  const other = typeof meta.requested_other === 'string' && meta.requested_other ? meta.requested_other : null;
  return teams.length || other ? { teams, other } : null;
}
