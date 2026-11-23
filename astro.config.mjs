import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

const site = process.env.SITE_URL || 'https://fusion-fc.local';
// The Supabase project's host, so uploaded photos can go through Vercel's image optimiser.
const supabaseHost = (() => {
  try {
    const raw = (process.env.PUBLIC_SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
    return raw ? new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname : null;
  } catch {
    return null;
  }
})();
const defaultAllowedHosts = ['localhost', '127.0.0.1', '.ngrok-free.app', '.ngrok.app'];
const extraAllowedHosts = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const allowedHosts = [...new Set([...defaultAllowedHosts, ...extraAllowedHosts])];

export default defineConfig({
  site,
  // Rendered on request (Vercel functions) so content edited in the portal,
  // team pages and vacancies show without a rebuild. Public pages are cached
  // briefly at the edge (see BaseLayout); robots.txt and the sitemap are
  // still built ahead of time.
  output: 'server',
  adapter: vercel({
    // Vercel Image Optimization: photos are resized per screen and served as
    // AVIF/WebP from the edge (see src/lib/images.ts, whose widths must match).
    imagesConfig: {
      sizes: [256, 384, 640, 828, 1080, 1200, 1920, 2048, 2560, 3840],
      formats: ['image/avif', 'image/webp'],
      minimumCacheTTL: 60 * 60 * 24 * 30,
      remotePatterns: [
        ...(supabaseHost ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }] : []),
        { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }
      ]
    }
  }),
  trailingSlash: 'always',
  vite: {
    server: {
      allowedHosts
    },
    preview: {
      allowedHosts
    }
  }
});
