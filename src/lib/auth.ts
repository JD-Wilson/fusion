import type { SupabaseClient } from '@supabase/supabase-js';

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  isAdmin: boolean;
  /** Teams this person manages (admins can edit every team). */
  teamIds: string[];
}

/** The signed-in user's profile and teams, or null when signed out. */
export async function loadSession(supabase: SupabaseClient): Promise<Session | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: managed }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('team_managers').select('team_id').eq('user_id', user.id)
  ]);
  if (!profile) return null;

  return {
    userId: user.id,
    email: profile.email as string,
    fullName: (profile.full_name as string) ?? '',
    phone: (profile.phone as string | null) ?? null,
    isAdmin: profile.role === 'club_admin',
    teamIds: (managed ?? []).map((m) => m.team_id as string)
  };
}

export const canEditTeam = (session: Session, teamId: string) =>
  session.isAdmin || session.teamIds.includes(teamId);
