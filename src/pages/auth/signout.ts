import type { APIRoute } from 'astro';
import { isSupabaseConfigured, serverSupabase } from '../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (isSupabaseConfigured) await serverSupabase(request, cookies).auth.signOut();
  return redirect('/login/', 303);
};
