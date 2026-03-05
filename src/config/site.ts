const FALLBACK_SITE_URL = 'https://fusionfc.co.uk';

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
  clubContactEmail: 'info@fusionfc.co.uk',
  clubPhone: '07852 344421'
} as const;

export const toAbsoluteUrl = (pathOrUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const cleanedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${siteConfig.siteUrl}${cleanedPath}`;
};
