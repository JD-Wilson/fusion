import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '../../lib/forms';
import { isSupabaseConfigured, serverSupabase } from '../../lib/supabase';

export const prerender = false;

/**
 * Landing point for links in Supabase emails (manager invites, password
 * resets, magic sign-in links). Exchanges the one-time token for a session,
 * then sends the user on; invites and resets land on the account page so they
 * can choose a password.
 */
export const GET: APIRoute = async ({ url, request, cookies, redirect }) => {
  if (!isSupabaseConfigured) return redirect('/login/');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  const supabase = serverSupabase(request, cookies);
  let ok = false;

  if (tokenHash && type) {
    // A sign-in link for an address with no account yet carries a sign-up
    // token, so verifying it as "magiclink" fails. "email" accepts both.
    const verifyAs: EmailOtpType = type === 'magiclink' || type === 'signup' ? 'email' : type;
    ok = !(await supabase.auth.verifyOtp({ type: verifyAs, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const destination = type === 'invite' || type === 'recovery' ? '/portal/account/?welcome=1' : next;
  return redirect(ok ? destination : '/login/?error=link');
};
