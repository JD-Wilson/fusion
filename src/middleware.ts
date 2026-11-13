import { defineMiddleware } from 'astro:middleware';
import { loadSession } from './lib/auth';
import { isSupabaseConfigured, serverSupabase } from './lib/supabase';

/**
 * Guards /portal. Everything else (including prerendered pages) is untouched,
 * so the static site stays static. Real permission checks also happen in each
 * page and again in the database (row-level security).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  context.locals.session = null;
  context.locals.supabase = null;

  if (!pathname.startsWith('/portal')) return next();

  if (!isSupabaseConfigured) return context.redirect('/login/');

  const supabase = serverSupabase(context.request, context.cookies);
  const session = await loadSession(supabase);
  if (!session) {
    return context.redirect(`/login/?next=${encodeURIComponent(pathname)}`);
  }
  context.locals.supabase = supabase;
  context.locals.session = session;

  const response = await next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
