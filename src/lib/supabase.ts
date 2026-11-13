import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

/** Trim whitespace and stray quotes from a pasted value. */
const clean = (value: string | undefined) =>
  value?.trim().replace(/^["']|["']$/g, '').trim() ?? '';

/** Accepts the URL with/without https://, or just the project id. Unusable → ''. */
function normaliseUrl(raw: string): string {
  if (!raw) return '';
  const value = /^[a-z0-9]{15,}$/.test(raw) ? `${raw}.supabase.co` : raw;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin;
  } catch {
    return '';
  }
}

const url = normaliseUrl(clean(import.meta.env.PUBLIC_SUPABASE_URL));
const anonKey = clean(import.meta.env.PUBLIC_SUPABASE_ANON_KEY);

/** False until Supabase is connected; the site then shows "coming soon" for app features. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let publicClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/** Anonymous, cookie-free client for public pages (parents). RLS applies. */
export function publicSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  publicClient ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return publicClient;
}

/**
 * Service-role client: bypasses RLS. Server-only, and only for things the
 * public can't be trusted to do themselves: saving enquiries, looking up a
 * manager's private WhatsApp number or email, and inviting managers.
 */
export function adminSupabase(): SupabaseClient | null {
  const key = clean(import.meta.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  adminClient ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return adminClient;
}

/** Session-aware client (reads and refreshes the login cookie). */
export function serverSupabase(request: Request, cookies: AstroCookies): SupabaseClient {
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map((c) => ({
          name: c.name,
          value: c.value ?? ''
        }));
      },
      setAll(list) {
        list.forEach(({ name, value, options }) => cookies.set(name, value, options));
      }
    }
  });
}
