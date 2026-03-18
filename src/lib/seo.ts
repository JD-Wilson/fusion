import { siteConfig, toAbsoluteUrl } from '../config/site';
import type { StructuredData } from '../types/seo';

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export const createBreadcrumbJsonLd = (items: BreadcrumbItem[]): StructuredData => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: toAbsoluteUrl(item.path)
  }))
});

export const createOrganizationJsonLd = (): StructuredData => ({
  '@context': 'https://schema.org',
  '@type': 'SportsOrganization',
  name: siteConfig.siteName,
  url: siteConfig.siteUrl,
  logo: toAbsoluteUrl('/brand/logo.jpeg'),
  email: siteConfig.clubContactEmail,
  telephone: siteConfig.clubPhone,
  areaServed: 'United Kingdom',
  sport: 'Football'
});

