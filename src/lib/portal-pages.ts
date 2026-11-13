import type { SupabaseClient } from '@supabase/supabase-js';
import { getCollection, getEntry } from 'astro:content';
import { CORE_PAGE_SLUGS } from './pages';

/** Page fields as edited in the portal. */
export interface EditablePage {
  slug: string;
  inDatabase: boolean;
  hasFile: boolean;
  core: boolean;
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
  updated_at: string | null;
}

/** Where each page lives on the website. */
export function publicPath(slug: string): string {
  if (slug === 'home') return '/';
  return CORE_PAGE_SLUGS.has(slug) ? `/${slug}/` : `/club/${slug}/`;
}

/** Friendly names for the core pages in the portal list. */
export const CORE_PAGE_NAMES: Record<string, string> = {
  home: 'Home page',
  about: 'About',
  'age-groups': 'Age Groups',
  'development-sessions': 'Development Sessions',
  leagues: 'Leagues',
  'new-sponsors': 'Sponsor Us',
  blog: 'Blog (intro)',
  contact: 'Contact',
  join: 'Join Us'
};

async function fromFile(slug: string): Promise<EditablePage | null> {
  const entry = await getEntry('pages', slug);
  if (!entry) return null;
  return {
    slug,
    inDatabase: false,
    hasFile: true,
    core: CORE_PAGE_SLUGS.has(slug),
    title: entry.data.title,
    description: entry.data.description,
    body: entry.body ?? '',
    nav_label: entry.data.navLabel ?? null,
    show_in_nav: Boolean(entry.data.showInNav),
    sort_order: entry.data.order ?? 100,
    hero_image: null,
    attachment_url: null,
    attachment_label: null,
    seo_title: entry.data.seoTitle ?? null,
    seo_description: entry.data.seoDescription ?? null,
    noindex: Boolean(entry.data.noindex),
    published: true,
    updated_at: null
  };
}

/** A page for editing: the database row (admins see unpublished ones), else its file. */
export async function loadEditablePage(supabase: SupabaseClient, slug: string): Promise<EditablePage | null> {
  const { data } = await supabase.from('site_pages').select('*').eq('slug', slug).maybeSingle();
  const hasFile = Boolean(await getEntry('pages', slug));
  if (data) return { ...(data as Omit<EditablePage, 'inDatabase' | 'hasFile' | 'core'>), slug, inDatabase: true, hasFile, core: CORE_PAGE_SLUGS.has(slug) };
  return fromFile(slug);
}

/** Every page: database rows plus files not yet imported. Core pages first. */
export async function listEditablePages(supabase: SupabaseClient): Promise<{ pages: EditablePage[]; tableReady: boolean }> {
  const { data, error } = await supabase.from('site_pages').select('*');
  const rows = (data ?? []) as EditablePage[];
  const files = await getCollection('pages');
  const fileSlugs = new Set(files.map((f) => f.id));
  const bySlug = new Map<string, EditablePage>();
  for (const row of rows) {
    bySlug.set(row.slug, { ...row, inDatabase: true, hasFile: fileSlugs.has(row.slug), core: CORE_PAGE_SLUGS.has(row.slug) });
  }
  for (const f of files) if (!bySlug.has(f.id)) bySlug.set(f.id, (await fromFile(f.id))!);
  const order = Object.keys(CORE_PAGE_NAMES);
  const pages = [...bySlug.values()].sort((a, b) =>
    a.core !== b.core
      ? a.core ? -1 : 1
      : a.core
        ? order.indexOf(a.slug) - order.indexOf(b.slug)
        : a.sort_order - b.sort_order || a.title.localeCompare(b.title)
  );
  return { pages, tableReady: !error };
}
