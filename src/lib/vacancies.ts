import { publicSupabase } from './supabase';

export const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] as const;

/**
 * Playing level a vacancy is for. The keys are what's stored in the database
 * (vacancies.experience); only the labels are shown.
 */
export const EXPERIENCE: Record<string, string> = {
  any: 'All abilities',
  beginner: 'Entry level',
  some: 'Intermediate',
  experienced: 'Advanced'
};

/** Levels parents can filter by ("All abilities" vacancies match every level). */
export const LEVELS = ['beginner', 'some', 'experienced'] as const;

export const KINDS: Record<string, string> = {
  player: 'Player',
  coach: 'Coach / helper'
};

export interface PublicVacancy {
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
  expires_on: string | null;
  created_at: string;
  team_name: string;
  team_slug: string;
  /** 'development' for development sessions, which have no team page. */
  team_kind?: 'team' | 'development';
  age_group: string;
  gender: 'Boys' | 'Girls' | 'Mixed';
  match_day: 'Saturday' | 'Sunday' | null;
  league: string | null;
  training: string | null;
}

export interface VacancyFilters {
  age?: string;
  position?: string;
  day?: string;
  gender?: string;
  kind?: string;
  /** One of LEVELS. */
  level?: string;
}

/** "U9" → 9, for sorting. */
export const ageNumber = (age: string) => Number.parseInt(age.replace(/\D/g, ''), 10) || 99;

/** Open vacancies visible to parents (RLS: published, open, unexpired). */
export async function getPublicVacancies(): Promise<PublicVacancy[] | null> {
  const db = publicSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from('vacancies_public')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[vacancies] load failed', error.message);
    return null;
  }
  return ((data ?? []) as PublicVacancy[]).sort(
    (a, b) => ageNumber(a.age_group) - ageNumber(b.age_group) || a.team_name.localeCompare(b.team_name)
  );
}

/** A vacancy with no positions listed means any position is welcome. */
export function filterVacancies(list: PublicVacancy[], f: VacancyFilters): PublicVacancy[] {
  return list.filter((v) => {
    if (f.age && v.age_group !== f.age) return false;
    if (f.day && v.match_day !== f.day) return false;
    if (f.gender && v.gender !== f.gender && v.gender !== 'Mixed') return false;
    if (f.kind && v.kind !== f.kind) return false;
    if (f.level && v.experience !== f.level && v.experience !== 'any') return false;
    if (f.position && v.positions.length > 0 && !v.positions.includes(f.position)) return false;
    return true;
  });
}

export const positionsLabel = (v: Pick<PublicVacancy, 'kind' | 'positions'>) =>
  v.kind === 'coach' ? 'Coach / helper' : v.positions.length ? v.positions.join(', ') : 'Any position';

/**
 * Accepts UK-style or international numbers ("07700 900123", "+44 7700 900123",
 * "0044…") and returns digits only for wa.me ("447700900123"), or null.
 */
export function normaliseWhatsApp(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export function whatsappMessage(v: Pick<PublicVacancy, 'contact_name' | 'team_name' | 'age_group' | 'kind' | 'positions'>) {
  const first = v.contact_name.split(' ')[0];
  const role =
    v.kind === 'coach'
      ? 'helping out as a coach'
      : v.positions.length === 1
        ? `a place as a ${v.positions[0].toLowerCase()}`
        : 'a place for my child';
  return `Hi ${first}, I saw the ${v.team_name} (${v.age_group}) vacancy on the Fusion FC website and I'm interested in ${role}. Is it still available?`;
}

export const whatsappLink = (digits: string, message: string) =>
  `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
