/*
 * Responsive photos through Vercel Image Optimization.
 *
 * On Vercel, a photo is served from /_vercel/image at the width each screen
 * needs, as AVIF or WebP when the browser supports it, and cached at the edge.
 * Phones get small files; large and high-resolution screens get sharp ones.
 * Works for the site's own photos (/images, /brand) and for photos uploaded
 * to Supabase Storage. Locally (astro dev) the original file is used.
 *
 * The allowed widths and sources must match `imagesConfig` in astro.config.mjs.
 */

/** Widths Vercel will produce (keep in step with astro.config.mjs). */
export const IMAGE_WIDTHS = [256, 384, 640, 828, 1080, 1200, 1920, 2048] as const;
type Width = (typeof IMAGE_WIDTHS)[number];

const SUPABASE_PUBLIC = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//i;

/** Only photos we host (or Supabase holds) can go through the optimiser; SVGs never. */
function optimisable(src: string): boolean {
  if (/\.svg(\?|$)/i.test(src)) return false;
  return (src.startsWith('/') && !src.startsWith('//')) || SUPABASE_PUBLIC.test(src);
}

const enabled = import.meta.env.PROD;

export const optimisedUrl = (src: string, width: Width, quality = 75) =>
  `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;

/** Sizes for the common places photos appear. */
const PRESETS = {
  /** Full-width page header. */
  hero: { widths: [828, 1200, 1920, 2048], sizes: '100vw', quality: 80 },
  /** Cards in a grid (team cards, vacancy and blog cards). */
  card: { widths: [384, 640, 828, 1080], sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 400px', quality: 75 },
  /** A larger image inside the page column (blog cover, about page). */
  content: { widths: [640, 828, 1200, 1920], sizes: '(max-width: 900px) 100vw, 900px', quality: 78 },
  /** A photo shown whole beside the page header (team pages). */
  feature: { widths: [640, 828, 1080, 1200], sizes: '(max-width: 720px) 100vw, 600px', quality: 80 },
  /** Small round portraits (coaches). */
  avatar: { widths: [256], sizes: '96px', quality: 75 },
  /** Sponsor logos. */
  logo: { widths: [256, 384, 640], sizes: '240px', quality: 85 }
} satisfies Record<string, { widths: Width[]; sizes: string; quality: number }>;

export type ImagePreset = keyof typeof PRESETS;

/**
 * `src`, `srcset` and `sizes` for an <img>: spread them onto the tag.
 *   <img {...responsive(photo, 'card')} alt="" loading="lazy" />
 * Anything that can't be optimised (or in local dev) gets just its src.
 */
export function responsive(src: string, preset: ImagePreset): { src: string; srcset?: string; sizes?: string } {
  if (!enabled || !src || !optimisable(src)) return { src };
  const { widths, sizes, quality } = PRESETS[preset];
  return {
    src: optimisedUrl(src, widths[Math.min(1, widths.length - 1)]!, quality),
    srcset: widths.map((w) => `${optimisedUrl(src, w, quality)} ${w}w`).join(', '),
    sizes
  };
}
