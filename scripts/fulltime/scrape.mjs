/*
 * Snapshots Fusion FC's fixtures, results and league tables from FA Full-Time into
 * src/data/fulltime.json. Ported from the Florence FC site (same parsers).
 *
 * Full-Time sits behind Cloudflare, which blocks plain server requests, so
 * this drives a real browser. It runs from GitHub Actions on a schedule
 * (.github/workflows/fulltime.yml), or locally with:
 *
 *   npm install --prefix scripts/fulltime
 *   npx --prefix scripts/fulltime playwright install chromium
 *   node scripts/fulltime/scrape.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

import { isChallenge, parseFixtures, parseOptions, parseResults, parseTable, slug } from './parse.mjs'

/*
 * Each league Fusion plays in, from the club's fixtures address on Full-Time
 * (filter a league's fixtures by Fusion FC and copy `selectedSeason` and
 * `selectedClub` from the address bar). The league's own ID is read from that
 * page. When the league moves on to a new season, the scraper follows it and
 * finds Fusion in the new season by name, so these only need updating if
 * Fusion joins or leaves a league.
 */
const CLUB_NAME = 'Fusion FC'
const SOURCES = [
  { name: 'Staffordshire Junior Football League', season: '921453866', club: '17632512' },
  { name: 'North Staffs Junior Youth League', season: '870995406', club: '261608494' },
]

const BASE = 'https://fulltime.thefa.com'
const OUT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../src/data/fulltime.json',
)

// Full Chromium with a visible window under a virtual display (HEADED=1)
// looks less like a bot to Cloudflare.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
  headless: process.env.HEADED !== '1',
  args: ['--disable-blink-features=AutomationControlled'],
})
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  locale: 'en-GB',
  timezoneId: 'Europe/London',
})
const page = await context.newPage()
const pause = (ms) => page.waitForTimeout(ms)

// Cloudflare's check redirects to the real page when it passes.
async function settled() {
  for (let i = 0; i < 25; i++) {
    try {
      await page.waitForLoadState('domcontentloaded')
      if (!/just a moment/i.test(await page.title())) return await page.content()
    } catch {
      // Mid-navigation; try again in a moment.
    }
    await pause(1000)
  }
  return page.content().catch(() => '')
}

async function load(pathname, params) {
  const url = new URL(pathname, BASE)
  url.search = new URLSearchParams(params).toString()
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const html = await settled()
    if (html && !isChallenge(html)) {
      await pause(3000)
      return html
    }
    console.warn(`Challenged on ${url.pathname} (attempt ${attempt})`)
    await pause(5000 * attempt)
  }
  throw new Error(`Couldn't get past Cloudflare for ${url}`)
}

function previousSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'))
  } catch {
    return null
  }
}

const team = (name) => ({ id: slug(name), name })
const isOurs = (club) => (m) => [m.home.name, m.away.name].some((n) => club.test(n))

try {
  const previous = previousSnapshot()
  const leagues = []
  const results = []
  const fixtures = []
  const tables = []
  const teams = new Set()

  for (const source of SOURCES) {
    // The league's menu links (Home, Fixtures, Tables…) carry its ID.
    const linkPage = await load('/fixtures.html', { selectedSeason: source.season, selectedClub: source.club })
    const ids = [...linkPage.matchAll(/[?&;]league=(\d+)/g)].map((m) => m[1])
    source.league = ids.sort((a, b) => ids.filter((x) => x === b).length - ids.filter((x) => x === a).length)[0]
    if (!source.league) {
      console.warn(`${source.name}: couldn't find the league's ID on Full-Time; skipping`)
      continue
    }
    const base = { league: source.league }
    // One table page gives the current season and the list of divisions.
    const tablePage = await load('/table.html', base)
    const season = parseOptions(tablePage, 'selectedSeason').find((o) => o.selected)
      ?? { value: source.season, label: null }
    const divisions = parseOptions(tablePage, 'selectedDivision')
    if (season.value !== source.season) {
      // A new season: club IDs can change, so find Fusion by name.
      const clubs = parseOptions(await load('/results.html', { ...base, selectedSeason: season.value }), 'selectedClub')
      const clubOption = clubs.find((o) => o.label.trim().toLowerCase() === CLUB_NAME.toLowerCase())
        ?? clubs.find((o) => o.label.toLowerCase().startsWith(CLUB_NAME.toLowerCase()))
      if (clubOption) source.club = clubOption.value
      else console.warn(`${source.name}: no "${CLUB_NAME}" in ${season.label ?? 'the new season'} yet; trying the old club ID`)
    }
    const list = {
      ...base,
      selectedSeason: season?.value ?? '',
      selectedFixtureGroupAgeGroup: '0',
      selectedFixtureGroupKey: '',
      selectedClub: source.club,
      selectedTeam: '',
      selectedRelatedFixtureOption: '3',
      itemsPerPage: '500',
      pageNumber: '1',
    }

    const resultsHtml = await load('/results.html', { ...list, selectedDateCode: 'all' })
    // The club filter's own label tells us how Full-Time names the club.
    const clubName = parseOptions(resultsHtml, 'selectedClub').find((o) => o.value === source.club)?.label ?? CLUB_NAME
    const ours = new RegExp(`^${clubName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const sourceResults = parseResults(resultsHtml)
      .map((m) => ({ ...m, league: source.name, home: team(m.home), away: team(m.away) }))
      .filter(isOurs(ours))

    let sourceFixtures
    try {
      sourceFixtures = parseFixtures(await load('/fixtures.html', { ...list, selectedDateCode: 'all' }))
        .map((m) => ({ ...m, league: source.name, home: team(m.home), away: team(m.away) }))
        .filter(isOurs(ours))
    } catch (error) {
      console.warn(`${source.name} fixtures: ${error.message}; keeping the previous list`)
      sourceFixtures = (previous?.fixtures ?? []).filter((m) => m.league === source.name)
    }

    for (const m of [...sourceResults, ...sourceFixtures]) {
      for (const side of [m.home, m.away]) if (ours.test(side.name)) teams.add(side.name)
    }
    // League tables for the divisions our teams play in. Mini-soccer
    // ("Under 9" etc.) has no standings, so only proper divisions.
    const played = new Set([...sourceResults, ...sourceFixtures].map((m) => m.competition))
    for (const division of divisions.filter((d) => played.has(d.label) && !/^Under \d+$/i.test(d.label))) {
      try {
        const rows = parseTable(
          await load('/table.html', { ...base, selectedSeason: season?.value ?? '', selectedDivision: division.value }),
        )
        if (!rows) throw new Error('no table on the page')
        tables.push({ league: source.name, division: division.label, rows })
      } catch (error) {
        console.warn(`${division.label} table: ${error.message}; keeping the previous one`)
        const old = previous?.tables?.find((t) => t.league === source.name && t.division === division.label)
        if (old) tables.push(old)
      }
    }

    results.push(...sourceResults)
    fixtures.push(...sourceFixtures)
    leagues.push({ name: source.name, league: source.league, club: source.club, season: season?.label ?? null })
    console.log(`${source.name}: ${sourceResults.length} results, ${sourceFixtures.length} fixtures, ${tables.length} tables`)
  }

  if (!results.length && !fixtures.length) {
    throw new Error('Nothing found; keeping the previous snapshot.')
  }

  const snapshot = {
    scrapedAt: new Date().toISOString(),
    leagues,
    teams: [...teams].sort(),
    results,
    fixtures,
    tables,
  }
  // Skip the write when only the timestamp changed, so quiet runs don't redeploy.
  const withoutTime = (snap) => JSON.stringify({ ...snap, scrapedAt: undefined })
  if (previous && withoutTime(previous) === withoutTime(snapshot)) {
    console.log('Nothing new on Full-Time')
    process.exit(0)
  }
  fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`)
  console.log(`Saved ${results.length} results and ${fixtures.length} fixtures for ${teams.size} teams`)
} finally {
  await browser.close()
}
