import { toAbsoluteUrl } from '../config/site';
import { getPosts, getSitePage, listClubPages } from '../lib/content';
import { getPublicTeams } from '../lib/teams';

// Generated per request (cached for an hour) so pages, posts and teams added
// in the portal appear without a rebuild.
export const prerender = false;

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
  const corePages = await Promise.all(
    ['home', 'about', 'age-groups', 'development-sessions', 'leagues', 'new-sponsors', 'blog', 'contact', 'join'].map((slug) => getSitePage(slug))
  );
  const pageBySlug = new Map(corePages.filter((p) => p !== null).map((p) => [p.id, p]));

  const staticPaths = [
    { path: '/', id: 'home' },
    { path: '/about/', id: 'about' },
    { path: '/her-game-too/', id: 'her-game-too' },
    { path: '/age-groups/', id: 'age-groups' },
    { path: '/development-sessions/', id: 'development-sessions' },
    { path: '/leagues/', id: 'leagues' },
    { path: '/new-sponsors/', id: 'new-sponsors' },
    { path: '/blog/', id: 'blog' },
    { path: '/contact/', id: 'contact' },
    { path: '/join/', id: 'join' },
    { path: '/vacancies/', id: 'vacancies' },
    { path: '/teams/', id: 'teams' },
    { path: '/fixtures/', id: 'fixtures' }
  ]
    .filter((route) => !pageBySlug.get(route.id)?.data.noindex)
    .map((route) => ({
      path: route.path,
      lastmod: undefined as string | undefined
    }));

  const extraClubPaths = (await listClubPages())
    .filter((entry) => !entry.data.noindex)
    .map((entry) => ({
      path: `/club/${entry.id}/`,
      lastmod: entry.updatedAt ?? undefined
    }));

  const blogPaths = (await getPosts()).filter((p) => !p.data.noindex).map((entry) => ({
    path: `/blog/${entry.id}/`,
    lastmod: (entry.data.updatedDate ?? entry.data.date).toISOString()
  }));

  // Team pages, read from the club database when the site is built.
  const teamPaths = ((await getPublicTeams()) ?? []).map((team) => ({ path: `/teams/${team.slug}/`, lastmod: undefined }));

  const urls = [...staticPaths, ...extraClubPaths, ...blogPaths, ...teamPaths];
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
