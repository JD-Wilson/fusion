import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

const site = process.env.SITE_URL || 'https://fusion-fc.local';
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
  adapter: vercel(),
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
