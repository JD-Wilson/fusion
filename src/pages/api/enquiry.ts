import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email';
import { EMAIL, UUID, line, text } from '../../lib/forms';
import { adminSupabase } from '../../lib/supabase';

export const prerender = false;

/** Bots fill forms instantly; people take a few seconds. */
const MIN_FILL_MS = 3000;
/** At most this many enquiries from one email address in the window. */
const MAX_PER_EMAIL = 3;
const WINDOW_MINUTES = 10;

/** Only send people back to a vacancies or team page on this site. */
function safeReturn(raw: string | null): string {
  return raw && /^\/(vacancies|teams\/[a-z0-9-]{1,80})\/$/.test(raw) ? raw : '/vacancies/';
}

/**
 * A parent's message about a vacancy (vacancy_id) or a team (team_id). Saved
 * to the portal inbox (managers see their own teams', admins see all) and
 * emailed to the right person with reply-to set to the parent. Written with
 * the service role only, so these checks can't be skipped by calling the
 * database directly.
 */
export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const returnTo = safeReturn(text(form, 'return', 120));
  const anchor = text(form, 'anchor', 60)?.replace(/[^a-z0-9-]/gi, '');
  const back = (kind: 'sent' | 'error', code: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${returnTo}?${kind}=${code}${anchor ? `#${anchor}` : ''}` }
    });

  // Honeypot: real people never fill this hidden field.
  if (text(form, 'website')) return back('sent', '1');
  const started = Number(text(form, 'started'));
  if (started && Date.now() - started < MIN_FILL_MS) return back('error', 'fast');

  const vacancyId = text(form, 'vacancy_id') ?? '';
  const teamIdRaw = text(form, 'team_id') ?? '';
  const name = line(form, 'name', 120);
  const email = line(form, 'email', 200)?.toLowerCase() ?? '';
  const message = text(form, 'message', 4000) ?? '';
  if ((!UUID.test(vacancyId) && !UUID.test(teamIdRaw)) || !name || !EMAIL.test(email) || message.length < 5) {
    return back('error', 'invalid');
  }

  const db = adminSupabase();
  if (!db) {
    console.error('[enquiry] SUPABASE_SERVICE_ROLE_KEY is not set');
    return back('error', 'failed');
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await db
    .from('enquiries')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', since);
  if ((count ?? 0) >= MAX_PER_EMAIL) return back('error', 'limit');

  // Work out the team (and vacancy) and check messages are switched on.
  let teamId: string;
  let vacancyRef: string | null = null;
  let to: string[] = [];
  let about: string;

  if (UUID.test(vacancyId)) {
    const { data: vacancy } = await db
      .from('vacancies')
      .select('id, team_id, email_enabled, status, published, teams(name, age_group, published)')
      .eq('id', vacancyId)
      .maybeSingle();
    const team = vacancy?.teams as unknown as { name: string; age_group: string; published: boolean } | null;
    if (!vacancy || vacancy.status !== 'open' || !vacancy.published || !vacancy.email_enabled || !team?.published) {
      return back('error', 'closed');
    }
    teamId = vacancy.team_id as string;
    vacancyRef = vacancyId;
    about = `your ${team.name} (${team.age_group}) vacancy`;
    const { data: contact } = await db.from('vacancy_contacts').select('email').eq('vacancy_id', vacancyId).maybeSingle();
    if (contact?.email) to = [contact.email as string];
  } else {
    const { data: team } = await db
      .from('teams')
      .select('id, name, age_group, published, email_enabled')
      .eq('id', teamIdRaw)
      .maybeSingle();
    if (!team || !team.published || !team.email_enabled) return back('error', 'closed');
    teamId = team.id as string;
    about = `${team.name} (${team.age_group})`;
  }

  if (!to.length) to = await teamRecipients(db, teamId);

  const phone = line(form, 'phone', 40);
  const playerName = line(form, 'player_name', 120);
  const playerAge = line(form, 'player_age', 40);

  const { error } = await db.from('enquiries').insert({
    team_id: teamId,
    vacancy_id: vacancyRef,
    name,
    email,
    phone,
    player_name: playerName,
    player_age: playerAge,
    message,
    emailed_to: to
  });
  if (error) {
    console.error('[enquiry] insert failed', error.message);
    return back('error', 'failed');
  }

  const siteUrl = (import.meta.env.SITE_URL ?? '').replace(/\/+$/, '');
  await sendEmail({
    to,
    subject: `[Fusion FC] New message about ${about.replace(/^your /, '')} from ${name}`,
    replyTo: email,
    text: [
      `New message about ${about}, from the Fusion FC website.`,
      '',
      `From: ${name} <${email}>`,
      phone && `Phone: ${phone}`,
      playerName && `Player: ${playerName}${playerAge ? ` (${playerAge})` : ''}`,
      '',
      message,
      '',
      'Reply to this email to answer them directly.',
      siteUrl && `See all enquiries: ${siteUrl}/portal/enquiries/`
    ]
      .filter((l): l is string => typeof l === 'string')
      .join('\n')
  });

  return back('sent', '1');
};

/** The team's contact email, else its managers who get enquiries, else the club inbox. */
async function teamRecipients(db: SupabaseClient, teamId: string): Promise<string[]> {
  const { data: contact } = await db.from('team_contacts').select('email').eq('team_id', teamId).maybeSingle();
  if (contact?.email) return [contact.email as string];

  const { data: managers } = await db
    .from('team_managers')
    .select('receives_enquiries, people(email)')
    .eq('team_id', teamId);
  // Coaches don't need a login to get enquiries, just an email in People.
  const emails = ((managers ?? []) as unknown as { receives_enquiries: boolean; people: { email: string | null } | null }[])
    .filter((m) => m.receives_enquiries && m.people?.email)
    .map((m) => m.people!.email!);
  if (emails.length) return emails;

  const { data: priv } = await db.from('club_private').select('inbox_email').eq('id', 1).maybeSingle();
  const inbox = priv?.inbox_email || import.meta.env.CLUB_INBOX_EMAIL;
  return inbox ? [inbox] : [];
}
