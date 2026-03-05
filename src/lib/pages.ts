import { getEntry } from 'astro:content';

export const CORE_PAGE_SLUGS = new Set([
  'home',
  'about',
  'age-groups',
  'leagues',
  'new-sponsors',
  'sponsors',
  'blog',
  'contact'
]);

export const getCorePagePath = (slug: string) => `/${slug}/`;

export const getClubPagePath = (slug: string) => `/club/${slug}/`;

export const requirePageEntry = async (slug: string) => {
  const entry = await getEntry('pages', slug);

  if (!entry) {
    throw new Error(`Missing required page content for slug: ${slug}`);
  }

  return entry;
};
