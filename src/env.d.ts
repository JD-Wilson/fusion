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
  /** Google Analytics 4 measurement ID ("G-…") the site sends visits to. Defaults to the one in src/config/site.ts. */
  readonly PUBLIC_GA_MEASUREMENT_ID?: string;
  /** Google Analytics 4 property number, for the admin Analytics page. */
  readonly GA_PROPERTY_ID?: string;
  /** Server only. A Google Cloud service account's JSON key (as-is or base64) with Viewer access to the GA property. */
  readonly GA_SERVICE_ACCOUNT_KEY?: string;
}

declare namespace App {
  interface Locals {
    /** Set by the middleware on /portal pages. */
    session: import('./lib/auth').Session | null;
    supabase: import('@supabase/supabase-js').SupabaseClient | null;
  }
}
