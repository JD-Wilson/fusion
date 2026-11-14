# Fusion Football Club Website

Astro website for Fusion FC, designed for Vercel hosting. Most pages are static and markdown-driven with full SEO support; the **vacancies page and the manager portal** are server-rendered and backed by Supabase.

## Stack

- Astro (TypeScript). Static by default; pages that opt out with `export const prerender = false` run on Vercel via `@astrojs/vercel`
- Markdown content collections (`src/content/**`) for the brochure pages
- **Supabase** (Postgres + Auth) for teams, vacancies, enquiries and manager logins

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

1. Create a Vercel project from this repo (framework preset: **Astro**).
2. Leave **Build command** and **Output directory** on their defaults. The site uses the `@astrojs/vercel` adapter, which writes Vercel's own output format; an output directory override such as `dist` breaks the deploy.
3. **Node.js version** (Settings → General): 22.x.
4. **Environment variables** (Settings → Environment Variables), from `.env.example`: `SITE_URL` (the live address, e.g. `https://fusionfc.co.uk`), `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `RESEND_API_KEY`, `EMAIL_FROM`, `CLUB_INBOX_EMAIL`, `PUBLIC_WEB3FORMS_KEY`.
5. **GitHub → Settings → Actions → General → Workflow permissions: Read and write**, so the Full-Time sync can commit fixture updates (which redeploys the site).

## Site structure

### Core pages

- `/`
- `/about/`
- `/age-groups/`
- `/leagues/`
- `/new-sponsors/`
- `/contact/`

### Dynamic pages

- `/blog/[slug]/` from `src/content/blog/*.md`
- `/club/[slug]/` from `src/content/pages/*.md` (non-core slugs)

The `sponsors` content collection and its `/sponsors/[slug]/` route were removed until there are real sponsors to list; `src/content.config.ts` still defines the schema so it's ready to reinstate.

## Content editing

**Club admins edit the website in the portal** (`/portal/` → Pages, Blog, Media, Teams); see "Editing the website" below. The markdown files in `src/content/` are the starting content and the fallback: anything not yet in the database is read from them, so the site still works before the content import or if Supabase is unreachable. After `seed-content.sql` has been run, edit pages and posts in the portal rather than here (file edits won't show for anything already imported).

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

Brand assets live in `public/brand/`.

- Current crest is `public/brand/logo.jpeg`.
- Replace with official logo files when available.
- Update any markdown frontmatter image paths as needed.

## Important placeholders to update before launch

- `clubContactEmail` in `src/config/site.ts`
- `SITE_URL` environment variable
- Temporary logo/images in `public/brand/`


## Design

Dark theme: near-black surfaces, hairline borders, one emerald accent, Inter Tight (headings) and Inter (body).

- **Tokens** live in `src/styles/tokens.css`. Use the semantic names (`--bg`, `--surface`, `--line`, `--text`, `--text-2`, `--accent`…) in new code. The older `--color-*` names still work: they're mapped onto the dark palette because the existing page styles use them.
- **Shared styles** are in `src/styles/global.css` (buttons, chips, `.dark-band` panels, `.dark-card` cards, `.prose`). The manager portal uses `src/styles/portal.css`.
- **Page heroes**: `<PageHero image="/images/web/….jpg" imagePosition="50% 40%" />` gives a full-bleed photo hero; leave `image` out for a text-only hero.
- **Photos**: use the web-sized copies in `public/images/web/` (about 150–500 KB). The originals in `public/images/` are 12–23 MB straight off the camera. To add one: `sips -Z 1600 -s format jpeg -s formatOptions 72 public/images/NAME.jpg --out public/images/web/NAME.jpg`.

## Team vacancies & manager portal

Parents see which teams need players (by age group, position, match day) at `/vacancies/` and contact the manager on **WhatsApp** or by email. Team managers and club leaders run it all from `/portal/`.

### How it works

| Who | What they can do |
| --- | --- |
| **Parents** (no login) | Filter vacancies, tap *Message on WhatsApp* (opens WhatsApp with a pre-written message) or send a message through the form |
| **Team managers** | Post, edit, fill and delete vacancies for **their own teams**; edit their teams' training details; see and update enquiries about their teams |
| **Club admins** | Everything above for every team, plus create teams, invite people, assign managers, change roles |

Pages: `/vacancies/` (public) · `/login/` · `/portal/` (dashboard) · `/portal/vacancies/` · `/portal/teams/` · `/portal/enquiries/` · `/portal/people/` (admins) · `/portal/account/`.

### Privacy and safeguarding

- A manager's WhatsApp number is **never in the page or the public API**. It lives in `vacancy_contacts` (staff-only). The *Message on WhatsApp* button links to `/vacancies/<id>/whatsapp/`, which looks the number up on the server and redirects to `wa.me`. It only works for open, published vacancies with WhatsApp switched on. The number *is* visible to anyone who follows the link, so managers tick a consent box per vacancy.
- Enquiries are written only by the server (service-role key) with a honeypot, a minimum fill time, and a limit of 3 per email per 10 minutes. Parents' details go only to the vacancy's contact, the team's managers, or the club inbox.
- Permissions are enforced in the page, and again by Supabase row-level security (`supabase/schema.sql`): managers can't touch other teams, can't move a vacancy to another team, and can't promote themselves.
- Vacancies disappear automatically after their *hide after* date, and when marked filled.

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL editor**: run `supabase/schema.sql`, then `supabase/seed.sql` (your existing teams, from `src/content/teams` via `npm run seed:sql`), then `supabase/seed-content.sql` (the site's pages and blog posts, from `src/content` via `npm run content:sql`). All are safe to re-run and never overwrite edits made in the portal.

   **Already set up from an earlier version?** Run the newer migrations in `supabase/migrations/` in order (each is safe to re-run): `002_team_pages.sql`, `003_fulltime.sql`, `004_site_content.sql`; then `seed.sql` again (fills in coach names) and `seed-content.sql`.
3. **Project Settings → API**: copy the URL, anon key and service-role key into `.env.local` and Vercel's environment variables (see `.env.example`).
4. **Authentication → URL Configuration**: set the Site URL to the live site and add `https://<your-site>/auth/confirm/` (and `http://localhost:4321/auth/confirm/`) to Redirect URLs.
5. **Authentication → Email Templates**: point the links at the site so they work with server-side login:
   - *Invite user*: `{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=invite`
   - *Reset password*: `{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=recovery`
   - *Magic Link*: `{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=magiclink`
6. **Turn off "Allow new users to sign up"** (Authentication → Sign In / Providers). Invites still work.
7. **Make the first admin.** Invite yourself from Authentication → Users → *Invite user*, accept the email, then run:

   ```sql
   update public.profiles set role = 'club_admin' where email = 'you@example.com';
   ```

   From then on, invite managers from **People** in the portal and add them to teams from each team's page.
8. Optional: set `RESEND_API_KEY` and `EMAIL_FROM` so enquiries are also emailed to managers.

Without Supabase variables the rest of the site works as before and `/vacancies/` shows a "coming soon" message.

### Editing the website (club admins)

| Portal section | What it changes |
| --- | --- |
| **Pages** | Every page's title, introduction, main text (markdown) and top photo. Club information pages (values, guides, codes of conduct, policies) can also be created, hidden, put in the menus, and given a PDF download. Core pages have **Restore original**. Some designed sections (forms, session cards, the Her Game Too page) are part of the templates and changed in code. |
| **Blog** | Write, edit, schedule (future date), un-publish and delete posts, with a cover photo and tags. |
| **Media** | Upload photos and PDFs, copy a ready-made link to paste into a page or post, delete files. |
| **Teams** | Create/delete teams and assign managers (admins); team photo, description, training, venue, contact details, Full-Time name (admins and that team's managers). |

Edits show on the website within a couple of minutes (pages are cached briefly at the edge). Everything has a **Preview** before saving. Photos are shrunk in the browser before upload, so phone photos work; PDFs can be up to 4MB.

Page content is markdown, rendered by the same engine as the files (`src/lib/markdown.ts`), and cleaned of scripts and similar before display.

## Fixtures, results and league tables (FA Full-Time)

Ported from the Florence FC site. Full-Time has no public API and blocks plain server requests, so:

1. **`scripts/fulltime/scrape.mjs`** drives a real browser (Playwright) through Full-Time for each league in `SOURCES` (starting from Fusion's fixtures page in that league), follows the league into new seasons, and writes **`src/data/fulltime.json`** (fixtures, results, league tables).
2. **`.github/workflows/fulltime.yml`** runs it on a schedule (weekend afternoons/evenings, Monday morning, Wednesday/Friday evenings) and commits the file when something changed; the push redeploys the site. Run it by hand from the repo's **Actions** tab (*Full-Time snapshot → Run workflow*).
3. The site shows it on **`/fixtures/`** (all teams, with a team filter) and on **each team page** (next fixtures, recent results, record and league table).

Teams are matched to Full-Time automatically by name ("U8 Black" ↔ "Fusion FC U8 Black", and "U10 Black Playing Up" ↔ "Fusion FC U10 Fusion FC PU Black"). If a name doesn't match, set it on the team's page in the portal (*Team name on FA Full-Time*, with a pick list once data exists).

**Leagues:** the Staffordshire Junior Football League (Saturday) and the North Staffs Junior Youth League (Sunday) are set up. To add a league, open its fixtures on fulltime.thefa.com filtered to Fusion FC, copy `selectedSeason` and `selectedClub` from the address bar into `SOURCES` in `scrape.mjs`, and commit.

The FA doesn't publish scores or tables for U11 and younger, so those games show as "Played"; tables appear automatically for age groups that have them.

Run it locally:

```bash
npm install --prefix scripts/fulltime
npx --prefix scripts/fulltime playwright install chromium
node scripts/fulltime/scrape.mjs
```
