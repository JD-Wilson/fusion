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
  logo: toAbsoluteUrl('/brand/logo-placeholder.svg'),
  email: siteConfig.clubContactEmail,
  telephone: siteConfig.clubPhone,
  areaServed: 'United Kingdom',
  sport: 'Football'
});

interface BlogPostingOptions {
  title: string;
  description: string;
  slug: string;
  publishedTime: string;
  modifiedTime?: string;
  image?: string;
}

export const createBlogPostingJsonLd = ({
  title,
  description,
  slug,
  publishedTime,
  modifiedTime,
  image
}: BlogPostingOptions): StructuredData => ({
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: title,
  description,
  datePublished: publishedTime,
  dateModified: modifiedTime ?? publishedTime,
  mainEntityOfPage: toAbsoluteUrl(`/blog/${slug}/`),
  image: toAbsoluteUrl(image ?? siteConfig.defaultOgImage),
  author: {
    '@type': 'Organization',
    name: siteConfig.siteName
  },
  publisher: {
    '@type': 'Organization',
    name: siteConfig.siteName,
    logo: {
      '@type': 'ImageObject',
      url: toAbsoluteUrl('/brand/logo-placeholder.svg')
    }
  }
});
