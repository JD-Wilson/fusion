# Fusion Football Club Website

Static Astro website for Fusion FC, designed for Vercel hosting with markdown-driven content and full SEO support.

## Stack

- Astro (TypeScript, static output)
- Markdown content collections (`src/content/**`)
- No database, no CMS required

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:4321](http://localhost:4321).

## Expose local dev with ngrok

```bash
# one-time setup (requires ngrok account token)
ngrok config add-authtoken <your-token>

# terminal 1
npm run dev

# terminal 2
npm run ngrok
```

The `ngrok` script forwards `http://localhost:4321`.

## Build and checks

```bash
npm run check
npm run build
```

## Deployment (Vercel)

1. Create a Vercel project from this repo.
2. Set environment variable `SITE_URL` to your production domain (for canonical URLs and sitemap).
3. Build command: `npm run build`
4. Output directory: `dist`

Use `.env.example` as a reference for local/production env values.

## Site structure

### Core pages

- `/`
- `/about/`
- `/age-groups/`
- `/leagues/`
- `/new-sponsors/`
- `/sponsors/`
- `/contact/`

### Dynamic pages

- `/blog/[slug]/` from `src/content/blog/*.md`
- `/sponsors/[slug]/` from `src/content/sponsors/*.md`
- `/club/[slug]/` from `src/content/pages/*.md` (non-core slugs)

## Content editing

All editable content is markdown in `src/content/`.

### Add a blog post

Create a new file in `src/content/blog/`:

```md
---
title: Example post
date: 2026-10-01
excerpt: One-line summary
coverImage: /brand/blog/example.svg
tags:
  - Club News
draft: false
author: Fusion Football Club
seoTitle: Example SEO title
seoDescription: Example SEO description
ogImage: /brand/blog/example.svg
noindex: false
---
Post body in markdown.
```

### Add a sponsor

Create a new file in `src/content/sponsors/`:

```md
---
name: Sponsor Name
summary: Short sponsor summary
logo: /brand/sponsors/sponsor-logo.svg
website: https://example.com
level: Community Partner
featured: false
order: 10
seoTitle: Sponsor SEO title
seoDescription: Sponsor SEO description
noindex: false
---
Sponsor profile content in markdown.
```

### Add team and league data

- Teams: `src/content/teams/*.md`
- Leagues: `src/content/leagues/*.md`

These feed `/age-groups/` and `/leagues/` automatically.

### Add extra static pages

Create a markdown file in `src/content/pages/` with a slug that is not one of:

- `home`, `about`, `age-groups`, `leagues`, `new-sponsors`, `sponsors`, `blog`, `contact`

The page is published at `/club/[slug]/`.

Set `showInNav: true` to include it in top navigation.

## SEO implementation

Implemented site-wide:

- Unique title and description support per page
- Canonical URLs
- Open Graph and Twitter card tags
- `robots.txt` (`/robots.txt`)
- Dynamic sitemap (`/sitemap.xml`)
- Structured data (JSON-LD):
  - `SportsOrganization` (site-wide)
  - `BreadcrumbList` (content pages)
  - `BlogPosting` (blog detail pages)

### SEO frontmatter fields

Supported across content collections:

- `seoTitle`
- `seoDescription`
- `canonicalUrl` (absolute URL)
- `ogImage`
- `noindex`

Blog-specific:

- `date`, `updatedDate`, `draft`

Rules:

- `draft: true` blog posts are not listed publicly.
- `noindex: true` pages include robots `noindex, nofollow` and are excluded from sitemap.
- If `SITE_URL` is missing, the whole site is set to `noindex` to prevent accidental indexing.

## Brand assets

Temporary brand assets live in `public/brand/`.

- Current crest uses `public/brand/logo-placeholder.svg`
- Replace with official logo files when available.
- Update any markdown frontmatter image paths as needed.

## Important placeholders to update before launch

- `clubContactEmail` and `clubPhone` in `src/config/site.ts`
- `SITE_URL` environment variable
- Temporary logo/images in `public/brand/`
