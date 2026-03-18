import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const seoFields = {
  seoTitle: z.string().max(90).optional(),
  seoDescription: z.string().max(180).optional(),
  canonicalUrl: z.string().url().optional(),
  ogImage: z.string().optional(),
  noindex: z.boolean().default(false)
};

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
    matchday: z.enum(['Saturday', 'Sunday']).optional(),
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
  sponsors,
  teams,
  leagues,
  pages
};
