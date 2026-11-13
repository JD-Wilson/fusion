import type { APIRoute } from 'astro';
import { adminSupabase } from '../../../lib/supabase';
import { getPublicTeam, teamWhatsappMessage } from '../../../lib/teams';
import { normaliseWhatsApp, whatsappLink } from '../../../lib/vacancies';

export const prerender = false;

/**
 * Opens WhatsApp with a pre-written message to the team's contact. The number
 * is never in the page or the public API: it's looked up here, and only for a
 * published team whose manager has switched WhatsApp on.
 */
export const GET: APIRoute = async ({ params }) => {
  const team = await getPublicTeam(params.slug ?? '');
  const admin = adminSupabase();
  if (!team || !admin) return new Response('Not found', { status: 404 });
  if (!team.whatsapp_enabled) return new Response('This team is not taking WhatsApp messages.', { status: 410 });

  const { data: contact } = await admin
    .from('team_contacts')
    .select('whatsapp_number')
    .eq('team_id', team.id)
    .maybeSingle();
  const digits = normaliseWhatsApp(contact?.whatsapp_number);
  if (!digits) return new Response('No WhatsApp number for this team.', { status: 404 });

  return new Response(null, {
    status: 302,
    headers: {
      Location: whatsappLink(digits, teamWhatsappMessage(team)),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
};
