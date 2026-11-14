import type { APIRoute } from 'astro';
import { renderMarkdown } from '../../lib/markdown';

export const prerender = false;

/** Renders editor markdown for the Preview tab (admins only; the middleware requires a login). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.session?.isAdmin) return new Response('Not allowed', { status: 403 });
  const source = (await request.text()).slice(0, 80000);
  return new Response(renderMarkdown(source), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
