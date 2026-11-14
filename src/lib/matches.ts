/**
 * Fusion FC's fixtures and results from FA Full-Time.
 *
 * The data is a snapshot in src/data/fulltime.json, refreshed by the
 * scheduled GitHub Action (.github/workflows/fulltime.yml), which commits it
 * and so redeploys the site. See scripts/fulltime/scrape.mjs.
 */
import snapshot from "../data/fulltime.json";

export type Side = { id: string; name: string };

export type Match = {
  id?: string;
  league: string;
  type: string;
  date: string; // YYYY-MM-DD (UK)
  time: string | null; // HH:MM, "00:00" when not set
  competition: string;
  home: Side;
  away: Side;
  venue: string | null;
  status: string | null;
  // Results only
  hidden?: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  penalties?: [number, number] | null;
  afterExtraTime?: boolean;
};

export type TableRow = {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
};

export type LeagueTable = { league: string; division: string; rows: TableRow[] };

type Snapshot = {
  scrapedAt: string | null;
  leagues: { name: string; day?: "Saturday" | "Sunday"; league: string; club: string; season: string | null }[];
  teams: string[];
  results: Match[];
  fixtures: Match[];
  tables?: LeagueTable[];
};

const data = snapshot as unknown as Snapshot;

/** When Full-Time was last read, and for which season. */
export const fulltimeInfo = {
  scrapedAt: data.scrapedAt,
  season: data.leagues[0]?.season ?? null,
  leagues: data.leagues.map((l) => l.name),
};

/** Every Fusion team name on Full-Time, for linking teams in the portal. */
export const fulltimeTeams = data.teams;

export const isFusion = (name: string) => /^Fusion FC\b/i.test(name);

/** True once the scheduled Full-Time sync has saved a snapshot. */
export const hasFulltimeData = Boolean(data.scrapedAt);

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

const involves = (team?: string) => (m: Match) =>
  !team || m.home.name === team || m.away.name === team;

/** Upcoming fixtures, soonest first. Postponed games are left out. */
export function upcomingFixtures({ team, limit }: { team?: string; limit?: number } = {}) {
  const from = today();
  return data.fixtures
    .filter((m) => m.date >= from && !/postponed|cancelled/i.test(m.status ?? ""))
    .filter(involves(team))
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`))
    .slice(0, limit);
}

/** Latest results, most recent first. */
export function latestResults({ team, limit }: { team?: string; limit?: number } = {}) {
  return data.results
    .filter(involves(team))
    .sort((a, b) => `${b.date}${b.time ?? ""}`.localeCompare(`${a.date}${a.time ?? ""}`))
    .slice(0, limit);
}

/** Group matches by date, keeping order. */
export function byDate(matches: Match[]) {
  const groups = new Map<string, Match[]>();
  for (const m of matches) groups.set(m.date, [...(groups.get(m.date) ?? []), m]);
  return [...groups.entries()];
}

/**
 * Confirmed kick-off time, or null for TBC. Until a club confirms a time,
 * Full-Time fills in 00:00, or 17:00 for weekend games (no junior game kicks
 * off then). Same rule as the NSJYL site.
 */
export function kickOff(m: Match): string | null {
  if (!m.time || m.time === "00:00") return null;
  const day = new Date(`${m.date}T12:00:00Z`).getUTCDay();
  if (m.time === "17:00" && (day === 0 || day === 6)) return null;
  return m.time;
}

/** Full-Time puts the home team's name as the venue when no pitch is named. */
export const venueOf = (m: Match) => (m.venue && m.venue !== m.home.name ? m.venue : null);

/** "W", "D" or "L" from a Fusion team's point of view, when the score is published. */
export function outcome(m: Match, team: string): "W" | "D" | "L" | null {
  if (m.hidden || m.homeScore == null || m.awayScore == null) return null;
  const ours = m.home.name === team ? m.homeScore : m.awayScore;
  const theirs = m.home.name === team ? m.awayScore : m.homeScore;
  return ours > theirs ? "W" : ours < theirs ? "L" : "D";
}

/** "Fusion FC U8 Black" → "U8 Black" (and tidies "U9 Fusion FC Black" → "U9 Black"). */
export const shortName = (name: string) => name.replace(/^Fusion FC\s*/i, "").replace(/\s*Fusion FC\s*/i, " ").trim() || name;

/**
 * A match from one Fusion team's side: who they are, who they played,
 * home or away, and the score with ours first. Without `team`, the first
 * Fusion side in the fixture is used (both, in a club derby).
 */
export function fromOurSide(m: Match, team?: string) {
  const homeIsUs = team ? m.home.name === team : isFusion(m.home.name);
  const us = homeIsUs ? m.home : m.away;
  const them = homeIsUs ? m.away : m.home;
  const scored = !m.hidden && m.homeScore != null && m.awayScore != null;
  return {
    us,
    them,
    home: homeIsUs,
    ourScore: scored ? (homeIsUs ? m.homeScore! : m.awayScore!) : null,
    theirScore: scored ? (homeIsUs ? m.awayScore! : m.homeScore!) : null,
    result: outcome(m, us.name),
  };
}

/** Played/won/drawn/lost from the results whose scores are published. */
export function seasonRecord(results: Match[], team: string) {
  const record = { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0 };
  for (const m of results) {
    const side = fromOurSide(m, team);
    if (!side.result) continue;
    record.played++;
    record.for += side.ourScore!;
    record.against += side.theirScore!;
    if (side.result === "W") record.won++;
    else if (side.result === "D") record.drawn++;
    else record.lost++;
  }
  return record;
}

/** Every Fusion team with games, for filters, in age order. */
export function teamsWithGames() {
  const names = new Set<string>();
  for (const m of [...data.fixtures, ...data.results]) {
    if (isFusion(m.home.name)) names.add(m.home.name);
    if (isFusion(m.away.name)) names.add(m.away.name);
  }
  const age = (n: string) => Number(n.match(/U(\d+)/i)?.[1] ?? 99);
  return [...names].sort((a, b) => age(a) - age(b) || a.localeCompare(b));
}

/** Monday of the week a match is in (YYYY-MM-DD), so a Saturday and Sunday count as one gameweek. */
export function weekOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Results from the most recent gameweek that had any (results are newest first). */
export function latestGameweek(results: Match[]) {
  if (!results.length) return [];
  const week = weekOf(results[0].date);
  return results.filter((m) => weekOf(m.date) === week);
}

/** Fixtures in the next `days` days (fixtures are soonest first); if none, the next matchday instead. */
export function comingUp(fixtures: Match[], days = 14) {
  const until = new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const soon = fixtures.filter((m) => m.date <= until);
  return soon.length ? soon : fixtures.filter((m) => m.date === fixtures[0]?.date);
}

/** The division table a team is in, and its row. Mini-soccer teams have none. */
export function tableFor(team: string) {
  for (const table of data.tables ?? []) {
    const row = table.rows.find((r) => r.team === team);
    if (row) return { ...table, row };
  }
  return null;
}

/** 1 → "1st", 22 → "22nd". */
export function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Compare names word by word in any order, reading Full-Time's "PU" as
 * "Playing Up": "U10 PU Black" matches the site's "U10 Black Playing Up".
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bpu\b/g, 'playing up')
    .replace(/\b\d+\s*(vs?|-a-side)\s*\d*\b/g, ' ') // formats Full-Time leaves out: "3vs3", "5v5", "7-a-side"
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

/**
 * The Full-Time name for one of our teams: the name a manager linked in the
 * portal if set, otherwise matched automatically ("U8 Black" on the site ↔
 * "Fusion FC U8 Black" on Full-Time). Only an unambiguous match is used.
 */
export function fulltimeNameFor(team: { name: string; fulltime_name?: string | null }): string | null {
  if (team.fulltime_name && data.teams.includes(team.fulltime_name)) return team.fulltime_name;
  const target = norm(team.name);
  const matches = data.teams.filter((t) => norm(shortName(t)) === target || norm(t) === target);
  return matches.length === 1 ? matches[0] : null;
}

/** A site name for a Full-Time team: "Fusion FC U10 Fusion FC PU Black" → "U10 Black Playing Up". */
export function siteNameFor(fulltimeName: string): string {
  let name = shortName(fulltimeName).replace(/\s+/g, " ").trim();
  if (/\bPU\b/i.test(name)) name = `${name.replace(/\s*\bPU\b\s*/i, " ").trim()} Playing Up`;
  return name;
}

export type FulltimeTeamDraft = {
  fulltimeName: string;
  name: string;
  age_group: string;
  gender: "Boys" | "Girls" | "Mixed";
  match_day: "Saturday" | "Sunday" | null;
  league: string | null;
  season: string | null;
};

/** What we know about a Full-Time team, ready to become a team on the site. */
export function fulltimeTeamDraft(fulltimeName: string): FulltimeTeamDraft | null {
  if (!data.teams.includes(fulltimeName)) return null;
  const game = [...data.fixtures, ...data.results].find((m) => m.home.name === fulltimeName || m.away.name === fulltimeName);
  const league = data.leagues.find((l) => l.name === game?.league);
  const name = siteNameFor(fulltimeName);
  const age = name.match(/\bU(\d{1,2})\b/i)?.[1] ?? game?.competition.match(/Under (\d{1,2})/i)?.[1];
  const day =
    league?.day ??
    (/Staffordshire Junior/i.test(league?.name ?? "") ? "Saturday" : /North Staffs/i.test(league?.name ?? "") ? "Sunday" : null);
  return {
    fulltimeName,
    name,
    age_group: age ? `U${age}` : "",
    gender: /\bgirls\b/i.test(fulltimeName) ? "Girls" : "Mixed",
    match_day: day,
    league: league?.name ?? game?.league ?? null,
    season: league?.season?.replace("-", "/") ?? null,
  };
}

/** Full-Time teams that no team on the site is linked to yet. */
export function unlinkedFulltimeTeams(teams: { name: string; fulltime_name?: string | null }[]): FulltimeTeamDraft[] {
  const linked = new Set(teams.map(fulltimeNameFor).filter(Boolean));
  return data.teams
    .filter((t) => !linked.has(t))
    .map(fulltimeTeamDraft)
    .filter((d): d is FulltimeTeamDraft => d !== null)
    .sort((a, b) => (a.match_day ?? "").localeCompare(b.match_day ?? "") || a.name.localeCompare(b.name, "en", { numeric: true }));
}
