/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SITE_URL?: string;
  readonly PUBLIC_WEB3FORMS_KEY?: string;
  /** Supabase → Project Settings → API. The anon key is safe to expose. */
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  /** Server only. Never expose. Used for invites, enquiries and WhatsApp lookups. */
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly CLUB_INBOX_EMAIL?: string;
}

declare namespace App {
  interface Locals {
    /** Set by the middleware on /portal pages. */
    session: import('./lib/auth').Session | null;
    supabase: import('@supabase/supabase-js').SupabaseClient | null;
  }
}
