const FALLBACK_SITE_URL = 'https://fusion-fc.local';

const normalizeSiteUrl = (url: string) => url.trim().replace(/\/+$/, '');

const configuredSiteUrl = normalizeSiteUrl(import.meta.env.SITE_URL ?? '');

export const isSiteUrlConfigured = configuredSiteUrl.length > 0;

export const siteConfig = {
  siteName: 'Fusion Football Club',
  siteUrl: isSiteUrlConfigured ? configuredSiteUrl : FALLBACK_SITE_URL,
  defaultTitle: 'Fusion Football Club',
  defaultDescription:
    'Fusion Football Club is a growing grassroots football community in the UK, supporting player development, team spirit, and local partnerships.',
  defaultOgImage: '/brand/og-default.svg',
  locale: 'en_GB',
  clubContactEmail: 'hello@fusionfc.example',
  clubPhone: '+44 7000 000000'
} as const;

export const toAbsoluteUrl = (pathOrUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const cleanedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${siteConfig.siteUrl}${cleanedPath}`;
};
