import type { APIRoute } from 'astro';
import { UUID } from '../../../lib/forms';
import { adminSupabase, publicSupabase } from '../../../lib/supabase';
import {
  normaliseWhatsApp,
  whatsappLink,
  whatsappMessage,
  type PublicVacancy
} from '../../../lib/vacancies';

export const prerender = false;

/**
 * Opens WhatsApp with a pre-written message to the vacancy's manager.
 *
 * The manager's number is never in the page or the public API: it's looked up
 * here, on the server, and only for a vacancy that is currently open and has
 * WhatsApp switched on. (Anyone who follows the link can still see the number
 * in WhatsApp, which is the point, so managers opt in per vacancy.)
 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  const pub = publicSupabase();
  const admin = adminSupabase();
  if (!UUID.test(id) || !pub || !admin) return new Response('Not found', { status: 404 });

  // The public view only returns open, published, unexpired vacancies.
  const { data: vacancy } = await pub
    .from('vacancies_public')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  const v = vacancy as PublicVacancy | null;
  if (!v || !v.whatsapp_enabled) return new Response('This vacancy is no longer open.', { status: 410 });

  const { data: contact } = await admin
    .from('vacancy_contacts')
    .select('whatsapp_number')
    .eq('vacancy_id', id)
    .maybeSingle();
  const digits = normaliseWhatsApp(contact?.whatsapp_number);
  if (!digits) return new Response('No WhatsApp number for this vacancy.', { status: 404 });

  await admin.rpc('bump_vacancy_clicks', { p_id: id });

  return new Response(null, {
    status: 302,
    headers: {
      Location: whatsappLink(digits, whatsappMessage(v)),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
};
