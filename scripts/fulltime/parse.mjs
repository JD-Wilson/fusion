/*
 * Parsers for the league's FA Full-Time pages, written against the real
 * markup (October 2026). Kept free of dependencies so the scraper can run
 * with nothing but Playwright installed.
 */

const entities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#039': "'",
}

function decode(value) {
  return value.replace(/&(#?\w+);/g, (match, name) => entities[name] ?? match)
}

export function text(html) {
  return decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function stripScripts(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
}

export function slug(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function isChallenge(html) {
  return /<title>\s*(Just a moment|Attention Required)/i.test(html)
}

export function parseOptions(html, name) {
  const select = html.match(
    new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`, 'i'),
  )
  if (!select) return []
  return [...select[1].matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map(([, attrs, label]) => ({
      value: decode(attrs.match(/value="([^"]*)"/i)?.[1] ?? ''),
      label: text(label),
      selected: /\bselected\b/i.test(attrs),
    }))
    .filter((o) => o.value && o.value !== '0' && o.label)
}

function parseDate(value) {
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!match) return null
  const [, d, m, y] = match
  return `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

const STATUSES = [
  [/postponed/i, 'Postponed'],
  [/abandoned/i, 'Abandoned'],
  [/home walkover|H\s*-\s*W/i, 'Home walkover'],
  [/away walkover|A\s*-\s*W/i, 'Away walkover'],
  [/void/i, 'Void'],
  [/cancelled/i, 'Cancelled'],
]

function parseScore(raw) {
  const status = STATUSES.find(([re]) => re.test(raw))?.[1] ?? null
  const score = raw.match(/^\s*(\d+)\s*-\s*(\d+)/)
  const penalties = raw.match(/Pens\s*(\d+)\s*-\s*(\d+)/i)
  return {
    status,
    // Under 11s and below show "X - X": the score isn't published.
    hidden: /^\s*X\s*-\s*X/i.test(raw),
    homeScore: score ? Number(score[1]) : null,
    awayScore: score ? Number(score[2]) : null,
    penalties: penalties ? [Number(penalties[1]), Number(penalties[2])] : null,
    afterExtraTime: /AET/i.test(raw),
  }
}

function competitionType(type) {
  // Some leagues add the age group, e.g. "LU10" for an Under 10 league game.
  if (/^L(U\d+)?$/i.test(type)) return 'League'
  if (/^(Cup|CU\d+)$/i.test(type)) return 'Cup'
  if (/^CC\b/i.test(type)) return 'County Cup'
  return type || 'Other'
}

function cell(row, className) {
  const match = row.match(
    new RegExp(`class="${className}[^"]*"[^>]*>([\\s\\S]*?)</(?:div|td)>`, 'i'),
  )
  return match ? text(match[1]) : ''
}

/*
 * results.html: one <div id="fixture-123"> per game, with type, date and
 * time, home team, score, away team and competition columns.
 */
export function parseResults(html) {
  const rows = stripScripts(html)
    .split(/id="fixture-/)
    .slice(1)
  return rows
    .map((row) => {
      const date = parseDate(cell(row, 'datetime-col'))
      const teamName = (side) =>
        text(
          row.match(
            new RegExp(
              `${side}-team-col[\\s\\S]*?class="team-name">([\\s\\S]*?)</div>`,
            ),
          )?.[1] ?? '',
        )
      const homeName = teamName('home')
      const awayName = teamName('road')
      const scoreRaw = text(
        row.match(/class="score-col">([\s\S]*?)<\/div>/)?.[1] ?? '',
      )
      if (!date || !homeName || !awayName) return null
      return {
        id: row.match(/^(\d+)/)?.[1],
        type: competitionType(cell(row, 'type-col')),
        date,
        time: row.match(/datetime-col[\s\S]*?(\d{1,2}:\d{2})/)?.[1] ?? null,
        competition: cell(row, 'fg-col'),
        home: homeName,
        away: awayName,
        venue: null,
        ...parseScore(scoreRaw),
      }
    })
    .filter(Boolean)
}

/*
 * fixtures.html: a plain table. Columns are type, date/time, home, logo,
 * "VS", logo, away, venue, competition and status/notes.
 */
export function parseFixtures(html) {
  const page = stripScripts(html)
  const start = page.indexOf('fixtures-table')
  if (start === -1) return []
  const table = page.slice(start, page.indexOf('</table>', start))
  return table
    .split(/<tr[\s>]/i)
    .slice(1)
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        text(c[1]),
      )
      if (cells.length < 9) return null
      const [type, when, home, , , , away, venue, competition, notes] = cells
      const date = parseDate(when)
      if (!date || !home || !away) return null
      return {
        id: row.match(/displayFixture\.html\?id=(\d+)/)?.[1],
        type: competitionType(type),
        date,
        time: when.match(/(\d{1,2}:\d{2})/)?.[1] ?? null,
        competition,
        home,
        away,
        venue: venue || null,
        status: notes || null,
      }
    })
    .filter(Boolean)
}

// table.html: POS, Team, then whichever stat columns the league shows.
export function parseTable(html) {
  const page = stripScripts(html)
  const table = (page.match(/<table[\s\S]*?<\/table>/gi) ?? []).find((t) =>
    /displayTeam\.html/i.test(t),
  )
  if (!table) return null
  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((h) =>
    text(h[1]).toUpperCase(),
  )
  const columns = {
    P: 'played',
    W: 'won',
    D: 'drawn',
    L: 'lost',
    F: 'goalsFor',
    A: 'goalsAgainst',
    GD: 'goalDifference',
    PTS: 'points',
  }
  const rows = table
    .split(/<tr[\s>]/i)
    .slice(1)
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        text(c[1]),
      )
      if (!/displayTeam\.html/i.test(row) || cells.length < 3) return null
      const entry = { position: Number(cells[0]), team: cells[1] }
      headers.forEach((header, i) => {
        if (columns[header] && /^-?\d+$/.test(cells[i])) {
          entry[columns[header]] = Number(cells[i])
        }
      })
      return entry
    })
    .filter(Boolean)
  return rows.length ? rows : null
}
