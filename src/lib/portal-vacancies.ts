import type { SupabaseClient } from '@supabase/supabase-js';
import { checked, line, text } from './forms';
import { EXPERIENCE, POSITIONS, normaliseWhatsApp } from './vacancies';

export interface VacancyRow {
  id: string;
  team_id: string;
  kind: 'player' | 'coach';
  positions: string[];
  spaces: number;
  experience: string;
  headline: string | null;
  description: string | null;
  contact_name: string;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  status: 'open' | 'filled';
  published: boolean;
  expires_on: string | null;
  whatsapp_clicks: number;
  created_at: string;
  teams?: { name: string; age_group: string } | null;
  vacancy_contacts?: { whatsapp_number: string | null; email: string | null } | null;
}

/** Read the vacancy form; returns an error message or the values to save. */
export function parseVacancyForm(form: FormData) {
  const team_id = text(form, 'team_id', 40);
  if (!team_id) return { error: 'Choose which team this is for.' };

  const kind = text(form, 'kind') === 'coach' ? 'coach' : 'player';
  const positions =
    kind === 'coach'
      ? []
      : form.getAll('positions').map(String).filter((p) => (POSITIONS as readonly string[]).includes(p));
  const experience = text(form, 'experience') ?? 'any';
  const contact_name = line(form, 'contact_name', 80);
  if (!contact_name) return { error: 'Add the name parents should ask for (for example "Coach Mark").' };

  const whatsapp_enabled = checked(form, 'whatsapp_enabled');
  const email_enabled = checked(form, 'email_enabled');
  const whatsapp_number = normaliseWhatsApp(text(form, 'whatsapp_number', 30));
  const contact_email = line(form, 'contact_email', 200)?.toLowerCase() ?? null;

  if (!whatsapp_enabled && !email_enabled) {
    return { error: 'Turn on at least one way for parents to get in touch (WhatsApp or a message form).' };
  }
  if (whatsapp_enabled && !whatsapp_number) {
    return { error: "That WhatsApp number doesn't look right. Use a mobile number like 07700 900123." };
  }
  if (whatsapp_enabled && !checked(form, 'consent')) {
    return { error: 'Please confirm you are happy for parents to see this number in WhatsApp.' };
  }
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return { error: "That contact email doesn't look right." };
  }

  const expires = text(form, 'expires_on', 10);
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { error: 'That expiry date is not valid.' };

  return {
    values: {
      team_id,
      kind,
      positions,
      spaces: Math.min(20, Math.max(1, Number(text(form, 'spaces', 3)) || 1)),
      experience: experience in EXPERIENCE ? experience : 'any',
      headline: line(form, 'headline', 80),
      description: text(form, 'description', 600),
      contact_name,
      whatsapp_enabled,
      email_enabled,
      status: text(form, 'status') === 'filled' ? 'filled' : 'open',
      published: checked(form, 'published'),
      expires_on: expires
    },
    contact: {
      // Keep the stored number even if WhatsApp is switched off, so it can be turned back on.
      whatsapp_number,
      email: contact_email
    }
  };
}

/** Save the private contact details for a vacancy (staff-only table). */
export async function saveContact(
  supabase: SupabaseClient,
  vacancyId: string,
  contact: { whatsapp_number: string | null; email: string | null }
) {
  return supabase.from('vacancy_contacts').upsert({ vacancy_id: vacancyId, ...contact });
}
