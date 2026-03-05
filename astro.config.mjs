import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL || 'https://fusion-fc.local';
const defaultAllowedHosts = ['localhost', '127.0.0.1', '.ngrok-free.app', '.ngrok.app'];
const extraAllowedHosts = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const allowedHosts = [...new Set([...defaultAllowedHosts, ...extraAllowedHosts])];

export default defineConfig({
  site,
  output: 'static',
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
