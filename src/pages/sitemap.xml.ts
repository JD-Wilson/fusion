import { getCollection } from 'astro:content';
import { toAbsoluteUrl } from '../config/site';
import { CORE_PAGE_SLUGS } from '../lib/pages';

export const prerender = true;

const xmlEscape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const normalizePath = (path: string) => (path.endsWith('/') ? path : `${path}/`);

const buildUrlEntry = (loc: string, lastmod?: string) => {
  const lastmodTag = lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : '';
  return `<url><loc>${xmlEscape(loc)}</loc>${lastmodTag}</url>`;
};

export async function GET() {
  const pageEntries = await getCollection('pages');
  const pageBySlug = new Map(pageEntries.map((entry) => [entry.id, entry]));

  const staticPaths = [
    { path: '/', id: 'home' },
    { path: '/about/', id: 'about' },
    { path: '/age-groups/', id: 'age-groups' },
    { path: '/development-sessions/', id: 'development-sessions' },
    { path: '/leagues/', id: 'leagues' },
    { path: '/new-sponsors/', id: 'new-sponsors' },
    { path: '/sponsors/', id: 'sponsors' },
    { path: '/blog/', id: 'blog' },
    { path: '/contact/', id: 'contact' }
  ]
    .filter((route) => !pageBySlug.get(route.id)?.data.noindex)
    .map((route) => ({
      path: route.path,
      lastmod: undefined as string | undefined
    }));

  const extraClubPaths = pageEntries
    .filter((entry) => !CORE_PAGE_SLUGS.has(entry.id) && !entry.data.noindex)
    .map((entry) => ({
      path: `/club/${entry.id}/`,
      lastmod: undefined
    }));

  const blogPaths = (await getCollection('blog', ({ data }) => !data.draft && !data.noindex)).map((entry) => ({
    path: `/blog/${entry.id}/`,
    lastmod: (entry.data.updatedDate ?? entry.data.date).toISOString()
  }));

  const sponsorPaths = (await getCollection('sponsors', ({ data }) => !data.noindex)).map((entry) => ({
    path: `/sponsors/${entry.id}/`,
    lastmod: undefined
  }));

  const urls = [...staticPaths, ...extraClubPaths, ...blogPaths, ...sponsorPaths];
  const uniqueUrls = Array.from(new Map(urls.map((url) => [url.path, url])).values());

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...uniqueUrls.map((url) => buildUrlEntry(toAbsoluteUrl(normalizePath(url.path)), url.lastmod)),
    '</urlset>'
  ].join('');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600'
    }
  });
}
