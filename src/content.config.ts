import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const seoFields = {
  seoTitle: z.string().max(90).optional(),
  seoDescription: z.string().max(180).optional(),
  canonicalUrl: z.string().url().optional(),
  ogImage: z.string().optional(),
  noindex: z.boolean().default(false)
};

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    excerpt: z.string(),
    coverImage: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    author: z.string().default('Fusion Football Club'),
    ...seoFields
  })
});

const sponsors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/sponsors' }),
  schema: z.object({
    name: z.string(),
    summary: z.string(),
    logo: z.string(),
    website: z.string().url().optional(),
    level: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().optional(),
    ...seoFields
  })
});

const teams = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/teams' }),
  schema: z.object({
    teamName: z.string(),
    ageGroup: z.string(),
    league: z.string(),
    season: z.string(),
    training: z.string().optional(),
    coach: z.string().optional(),
    ...seoFields
  })
});

const leagues = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/leagues' }),
  schema: z.object({
    name: z.string(),
    ageBand: z.string(),
    division: z.string().optional(),
    season: z.string(),
    region: z.string().optional(),
    website: z.string().url().optional(),
    ...seoFields
  })
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    navLabel: z.string().optional(),
    order: z.number().optional(),
    showInNav: z.boolean().default(false),
    ...seoFields
  })
});

export const collections = {
  blog,
  sponsors,
  teams,
  leagues,
  pages
};
