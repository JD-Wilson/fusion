import { isSiteUrlConfigured, siteConfig } from '../config/site';

export const prerender = true;

export function GET() {
  const lines = [
    'User-agent: *',
    isSiteUrlConfigured ? 'Allow: /' : 'Disallow: /',
    `Sitemap: ${siteConfig.siteUrl}/sitemap.xml`
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
