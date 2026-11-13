import { getCollection, getEntry } from 'astro:content';
import { renderMarkdown } from './markdown';
import { CORE_PAGE_SLUGS } from './pages';
import { publicSupabase } from './supabase';

/*
 * Website content: pages (about, join, guides, policies…) and blog posts.
 *
 * Club admins edit these in the portal; they're stored in Supabase
 * (`site_pages`, `posts`). Anything not in the database yet falls back to the
 * markdown files in src/content, so the site works before the content import
 * and if the database is ever unreachable.
 *
 * Both sources come back in the same shape as Astro content entries
 * (`{ id, data, body }`) plus the rendered `html`, so pages use them the
 * same way whichever source they came from.
 */

export interface SitePage {
  id: string;
  source: 'database' | 'file';
  body: string;
  html: string;
  heroImage: string | null;
  attachment: { url: string; label: string } | null;
  updatedAt: string | null;
  data: {
    title: string;
    description: string;
    navLabel?: string;
    order?: number;
    showInNav: boolean;
    seoTitle?: string;
    seoDescription?: string;
    canonicalUrl?: string;
    ogImage?: string;
    noindex: boolean;
  };
}

export interface Post {
  id: string;
  source: 'database' | 'file';
  body: string;
  html: string;
  data: {
    title: string;
    date: Date;
    updatedDate?: Date;
    excerpt: string;
    coverImage: string;
    tags: string[];
    draft: boolean;
    author: string;
    seoTitle?: string;
    seoDescription?: string;
    canonicalUrl?: string;
    ogImage?: string;
    noindex: boolean;
  };
}

type PageRow = {
  slug: string;
  title: string;
  description: string;
  body: string;
  nav_label: string | null;
  show_in_nav: boolean;
  sort_order: number;
  hero_image: string | null;
  attachment_url: string | null;
  attachment_label: string | null;
  seo_title: string | null;
  seo_description: string | null;
  noindex: boolean;
  published: boolean;
  updated_at: string;
};

type PostRow = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  body: string;
  cover_image: string | null;
  tags: string[];
  author: string;
  draft: boolean;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
};

const DEFAULT_COVER = '/brand/logo.jpeg';
const nn = <T>(v: T | null | undefined) => (v === null ? undefined : v);

// ─── Small per-instance cache: content changes rarely, and the header and
// footer ask for the page list on every request. Edits show within a minute.
const TTL = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Forget cached content (the portal calls this after saving). */
export const clearContentCache = () => cache.clear();

// ─── Pages ──────────────────────────────────────────────────────────────

function fromPageRow(row: PageRow): SitePage {
  return {
    id: row.slug,
    source: 'database',
    body: row.body,
    html: renderMarkdown(row.body),
    heroImage: row.hero_image,
    attachment: row.attachment_url ? { url: row.attachment_url, label: row.attachment_label || 'Download PDF' } : null,
    updatedAt: row.updated_at,
    data: {
      title: row.title,
      description: row.description,
      navLabel: nn(row.nav_label),
      order: row.sort_order,
      showInNav: row.show_in_nav,
      seoTitle: nn(row.seo_title),
      seoDescription: nn(row.seo_description),
      noindex: row.noindex
    }
  };
}

async function fromPageFile(slug: string): Promise<SitePage | null> {
  const entry = await getEntry('pages', slug);
  if (!entry) return null;
  const body = entry.body ?? '';
  return {
    id: entry.id,
    source: 'file',
    body,
    html: renderMarkdown(body),
    heroImage: null,
    attachment: null,
    updatedAt: null,
    data: { ...entry.data, showInNav: Boolean(entry.data.showInNav), noindex: Boolean(entry.data.noindex) }
  };
}

/** All published page rows from the database, or null when it can't be reached. */
async function pageRows(): Promise<PageRow[] | null> {
  return cached('pages', async () => {
    const db = publicSupabase();
    if (!db) return null;
    const { data, error } = await db.from('site_pages').select('*').eq('published', true);
    if (error) {
      // Before migration 004 the table doesn't exist: quietly use the files.
      if (error.code !== '42P01' && error.code !== 'PGRST205') console.error('[content] pages', error.message);
      return null;
    }
    return data as PageRow[];
  });
}

/** Slugs an admin has unpublished: hidden even if a markdown file exists. */
async function hiddenSlugs(): Promise<Set<string>> {
  return cached('hidden', async () => {
    const db = publicSupabase();
    if (!db) return new Set<string>();
    const { data, error } = await db.from('site_page_states').select('slug').eq('published', false);
    return new Set(error ? [] : (data ?? []).map((r) => r.slug as string));
  });
}

/** One page by slug: the database version if there is one, else the file. */
export async function getSitePage(slug: string): Promise<SitePage | null> {
  if ((await hiddenSlugs()).has(slug)) return null;
  const row = (await pageRows())?.find((r) => r.slug === slug);
  return row ? fromPageRow(row) : fromPageFile(slug);
}

/** Like getSitePage, for the core pages that must exist. */
export async function requireSitePage(slug: string): Promise<SitePage> {
  const page = await getSitePage(slug);
  if (!page) throw new Error(`Missing required page content for slug: ${slug}`);
  return page;
}

/**
 * Club information pages (values, guides, codes of conduct, policies): every
 * page that isn't one of the site's core pages. Database pages first, plus
 * any file pages not yet imported. Sorted by their menu order.
 */
export async function listClubPages(): Promise<SitePage[]> {
  const rows = (await pageRows()) ?? [];
  const fromDb = rows.filter((r) => !CORE_PAGE_SLUGS.has(r.slug)).map(fromPageRow);
  const seen = new Set([...fromDb.map((p) => p.id), ...(await hiddenSlugs())]);
  const files = (await getCollection('pages'))
    .filter((e) => !CORE_PAGE_SLUGS.has(e.id) && !seen.has(e.id))
    .map((e) => ({
      id: e.id,
      source: 'file' as const,
      body: e.body ?? '',
      html: '',
      heroImage: null,
      attachment: null,
      updatedAt: null,
      data: { ...e.data, showInNav: Boolean(e.data.showInNav), noindex: Boolean(e.data.noindex) }
    }));
  return [...fromDb, ...files].sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999));
}

/** Club pages for menus: shown in navigation and not hidden from search. */
export async function clubNavLinks() {
  return (await listClubPages())
    .filter((p) => p.data.showInNav && !p.data.noindex)
    .map((p) => ({ href: `/club/${p.id}/`, label: p.data.navLabel ?? p.data.title }));
}

// ─── Blog posts ─────────────────────────────────────────────────────────

function fromPostRow(row: PostRow): Post {
  return {
    id: row.slug,
    source: 'database',
    body: row.body,
    html: renderMarkdown(row.body),
    data: {
      title: row.title,
      date: new Date(`${row.date}T12:00:00Z`),
      updatedDate: row.updated_at ? new Date(row.updated_at) : undefined,
      excerpt: row.excerpt,
      coverImage: row.cover_image || DEFAULT_COVER,
      tags: row.tags ?? [],
      draft: row.draft,
      author: row.author,
      seoTitle: nn(row.seo_title),
      seoDescription: nn(row.seo_description),
      ogImage: nn(row.cover_image),
      noindex: false
    }
  };
}

/**
 * Published posts, newest first. Once posts are in the database it is the
 * only source (so deleting or un-publishing a post in the portal removes it);
 * the markdown files are used only before the import or if it's unreachable.
 */
export async function getPosts(): Promise<Post[]> {
  const rows = await cached('posts', async () => {
    const db = publicSupabase();
    if (!db) return null;
    const { data, error } = await db.from('posts').select('*').order('date', { ascending: false });
    if (error) {
      if (error.code !== '42P01' && error.code !== 'PGRST205') console.error('[content] posts', error.message);
      return null;
    }
    return data as PostRow[];
  });

  if (rows && rows.length) return rows.map(fromPostRow);

  const files = await getCollection('blog', ({ data }) => !data.draft && !data.noindex);
  return files
    .map((e) => ({
      id: e.id,
      source: 'file' as const,
      body: e.body ?? '',
      html: '',
      data: { ...e.data, noindex: Boolean(e.data.noindex) }
    }))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getPost(slug: string): Promise<Post | null> {
  const post = (await getPosts()).find((p) => p.id === slug);
  if (!post) return null;
  return post.html ? post : { ...post, html: renderMarkdown(post.body) };
}
