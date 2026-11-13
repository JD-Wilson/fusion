import { markdownToHtml } from 'satteri';

/**
 * Render page and post markdown to HTML with the same engine Astro uses for
 * the markdown files (GFM, smart quotes, inline HTML kept), so content edited
 * in the portal looks exactly like content written in src/content.
 *
 * Content comes from club admins, who are trusted, but the HTML is still
 * cleaned of anything that could run code (scripts, frames, event handlers,
 * javascript: links) in case an admin account is ever misused.
 */
export function renderMarkdown(source: string): string {
  const { html } = markdownToHtml(source ?? '', { features: { gfm: true, smartPunctuation: true, frontmatter: false } });
  return sanitize(html);
}

export function sanitize(html: string): string {
  return (
    html
      // Elements that run code or embed other documents: drop them and their contents
      .replace(/<(script|style|iframe|frame|frameset|object|embed|applet|form|template|noscript|meta|link|base)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?(script|style|iframe|frame|frameset|object|embed|applet|form|template|noscript|meta|link|base)\b[^>]*>/gi, '')
      // Inline event handlers (onclick=, onerror=…)
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // javascript:/vbscript:/data: URLs in links and sources (data: images are allowed)
      .replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript):[^"'\s>]*\2/gi, '')
      .replace(/\s(href|action|formaction)\s*=\s*(["']?)\s*data:[^"'\s>]*\2/gi, '')
      // Inline styles can hide or overlay content; the site's CSS handles styling
      .replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, '')
  );
}

/** Rough reading time in minutes. */
export const readingMinutes = (source: string) => Math.max(1, Math.round((source ?? '').split(/\s+/).length / 200));
