/*
 * Google Analytics 4 figures for the admin dashboard, from the GA Data API.
 *
 * Signs in as a Google Cloud service account (a robot login with read-only
 * "Viewer" access to the GA property), entirely on the server: the key never
 * reaches the browser. Needs two environment variables:
 *   GA_PROPERTY_ID          the property's number (GA → Admin → Property details)
 *   GA_SERVICE_ACCOUNT_KEY  the service account's JSON key (pasted as-is, or base64)
 * Results are kept for an hour so the page is quick and well inside the API's free quota.
 */

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const CACHE_MS = 60 * 60 * 1000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() ?? '';

function propertyId(): string | null {
  const raw = clean(import.meta.env.GA_PROPERTY_ID).replace(/^properties\//, '');
  return /^\d{5,}$/.test(raw) ? raw : null;
}

function serviceAccount(): ServiceAccount | null {
  const raw = clean(import.meta.env.GA_SERVICE_ACCOUNT_KEY);
  if (!raw) return null;
  const decoded = (() => {
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
    } catch {
      return '';
    }
  })();
  for (const text of [raw, decoded]) {
    try {
      const key = JSON.parse(text) as ServiceAccount;
      if (key.client_email && key.private_key) return { ...key, private_key: key.private_key.replace(/\\n/g, '\n') };
    } catch {
      // try the next form
    }
  }
  return null;
}

export const isAnalyticsConfigured = () => Boolean(propertyId() && serviceAccount());

let token: { value: string; expires: number } | null = null;

async function accessToken(key: ServiceAccount): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const b64 = (v: string | ArrayBuffer) => {
    const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })
  )}`;
  const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----|\s+/g, '')), (c) => c.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(unsigned));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64(signature)}` })
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description ?? res.status}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

interface ReportRow {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
interface Report {
  rows?: ReportRow[];
}

async function batch(property: string, key: ServiceAccount, requests: object[]): Promise<Report[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(key)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  const body = (await res.json()) as { reports?: Report[]; error?: { message?: string; status?: string } };
  if (!res.ok) {
    const message = body.error?.message ?? String(res.status);
    throw new Error(
      body.error?.status === 'PERMISSION_DENIED'
        ? `Google Analytics refused access. Check the service account (${key.client_email}) is a Viewer on the property. (${message})`
        : `Google Analytics: ${message}`
    );
  }
  return body.reports ?? [];
}

// ---------------------------------------------------------------------------

export interface Totals {
  visitors: number;
  visits: number;
  pageViews: number;
  /** Seconds. */
  avgVisit: number;
}

export interface Share {
  label: string;
  value: number;
}

export interface AnalyticsDashboard {
  current: Totals;
  previous: Totals;
  /** Per day, oldest first: 118 days ending today (90 to show, plus 28 earlier to compare against). */
  daily: { date: string; visitors: number; visits: number; pageViews: number }[];
  /** New vs returning visitors, last 28 days. */
  audience: Share[];
  /** Visits by weekday (0 = Monday) and hour (0–23), last 28 days. */
  heat: { day: number; hour: number; value: number }[];
  pages: Share[];
  channels: Share[];
  sources: Share[];
  devices: Share[];
  towns: Share[];
  fetchedAt: string;
}

const CURRENT = { startDate: '27daysAgo', endDate: 'today', name: 'current' };
const PREVIOUS = { startDate: '55daysAgo', endDate: '28daysAgo', name: 'previous' };
const num = (v: string | undefined) => Number(v ?? 0) || 0;

function shares(report: Report | undefined, skip: RegExp = /^\(not set\)$|^$/): Share[] {
  return (report?.rows ?? [])
    .map((r) => ({ label: r.dimensionValues?.[0]?.value ?? '', value: num(r.metricValues?.[0]?.value) }))
    .filter((s) => !skip.test(s.label));
}

const top = (dimension: string, metric: string, limit: number) => ({
  dateRanges: [CURRENT],
  dimensions: [{ name: dimension }],
  metrics: [{ name: metric }],
  orderBys: [{ metric: { metricName: metric }, desc: true }],
  limit
});

let cache: { at: number; data: AnalyticsDashboard } | null = null;

/** The dashboard's figures, or an error to show. `null` data means not set up yet. */
export async function loadAnalytics(fresh = false): Promise<{ data: AnalyticsDashboard | null; error?: string }> {
  const property = propertyId();
  const key = serviceAccount();
  if (!property || !key) return { data: null };
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return { data: cache.data };

  try {
    const metrics = ['activeUsers', 'sessions', 'screenPageViews', 'averageSessionDuration'].map((name) => ({ name }));
    const [first, second] = await Promise.all([
      batch(property, key, [
        { dateRanges: [CURRENT, PREVIOUS], metrics },
        {
          dateRanges: [{ startDate: '117daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 200
        },
        top('pagePath', 'screenPageViews', 10),
        top('sessionDefaultChannelGroup', 'sessions', 8),
        top('deviceCategory', 'activeUsers', 5)
      ]),
      batch(property, key, [
        top('city', 'activeUsers', 9),
        top('sessionSource', 'sessions', 9),
        top('newVsReturning', 'activeUsers', 4),
        { dateRanges: [CURRENT], dimensions: [{ name: 'dayOfWeek' }, { name: 'hour' }], metrics: [{ name: 'sessions' }], limit: 200 }
      ])
    ]);

    const totals = (name: string): Totals => {
      // With two date ranges GA adds a "dateRange" dimension to each row.
      const row = first[0]?.rows?.find((r) => r.dimensionValues?.[0]?.value === name);
      const m = row?.metricValues ?? [];
      return { visitors: num(m[0]?.value), visits: num(m[1]?.value), pageViews: num(m[2]?.value), avgVisit: num(m[3]?.value) };
    };

    // Every day appears, with 0 for days with no visits.
    const byDay = new Map((first[1]?.rows ?? []).map((r) => [r.dimensionValues?.[0]?.value ?? '', r.metricValues ?? []]));
    const daily: AnalyticsDashboard['daily'] = [];
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) + 'T00:00:00Z');
    for (let i = 117; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      const m = byDay.get(d.replace(/-/g, '')) ?? [];
      daily.push({ date: d, visitors: num(m[0]?.value), visits: num(m[1]?.value), pageViews: num(m[2]?.value) });
    }

    // GA's dayOfWeek is 0 = Sunday; show Monday first.
    const heat = (second[3]?.rows ?? []).map((r) => ({
      day: (Number(r.dimensionValues?.[0]?.value ?? 0) + 6) % 7,
      hour: Number(r.dimensionValues?.[1]?.value ?? 0),
      value: num(r.metricValues?.[0]?.value)
    }));
    const audienceNames: Record<string, string> = { new: 'New visitors', returning: 'Returning visitors' };

    const data: AnalyticsDashboard = {
      current: totals('current'),
      previous: totals('previous'),
      daily,
      pages: shares(first[2]),
      channels: shares(first[3], /^\(not set\)$|^$|^Unassigned$/),
      devices: shares(first[4]).map((s) => ({ ...s, label: s.label.charAt(0).toUpperCase() + s.label.slice(1) })),
      towns: shares(second[0]).slice(0, 8),
      sources: shares(second[1]).slice(0, 8),
      audience: shares(second[2]).map((s) => ({ ...s, label: audienceNames[s.label] ?? s.label })),
      heat,
      fetchedAt: new Date().toISOString()
    };
    cache = { at: Date.now(), data };
    return { data };
  } catch (err) {
    console.error('[analytics]', err);
    return { data: cache?.data ?? null, error: err instanceof Error ? err.message : 'Google Analytics could not be reached.' };
  }
}

export interface Realtime {
  /** Visitors in the last 30 minutes. */
  visitors: number;
  pages: Share[];
}

let realtimeCache: { at: number; data: Realtime } | null = null;

/**
 * Who's on the site in the last 30 minutes (GA's realtime data, which shows
 * within a minute; the other reports take a day or two). Kept for a minute.
 */
export async function loadRealtime(): Promise<Realtime | null> {
  const property = propertyId();
  const key = serviceAccount();
  if (!property || !key) return null;
  if (realtimeCache && Date.now() - realtimeCache.at < 60_000) return realtimeCache.data;
  try {
    const call = async (body: object) => {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runRealtimeReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken(key)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Realtime ${res.status}: ${await res.text()}`);
      return (await res.json()) as Report;
    };
    const [total, pages] = await Promise.all([
      call({ metrics: [{ name: 'activeUsers' }] }),
      call({ dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }], limit: 5 })
    ]);
    const data = { visitors: num(total.rows?.[0]?.metricValues?.[0]?.value), pages: shares(pages) };
    realtimeCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error('[analytics] realtime', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// One team's pages

export interface PageStats {
  current: Omit<Totals, 'avgVisit'>;
  previous: Omit<Totals, 'avgVisit'>;
  /** Per day, oldest first: 118 days ending today (same shape as the club trend). */
  daily: AnalyticsDashboard['daily'];
  /** How people arrived, last 28 days (sessions that viewed these pages). */
  channels: Share[];
}

const pageCache = new Map<string, { at: number; data: PageStats }>();

/**
 * Figures for a set of pages (a team's page and its vacancy pages). Each path
 * is matched as itself or anything beneath it, e.g. "/teams/u10-blue/".
 * Kept for an hour per team.
 */
export async function loadPageStats(cacheKey: string, paths: string[]): Promise<{ data: PageStats | null; error?: string }> {
  const property = propertyId();
  const key = serviceAccount();
  if (!property || !key || paths.length === 0) return { data: null };
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return { data: cached.data };

  // "/teams/u8/" must not also match "/teams/u8-white/", so match the path
  // with its trailing slash, or exactly without it.
  const expressions = paths.flatMap((p) => {
    const withSlash = p.endsWith('/') ? p : `${p}/`;
    return [
      { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: withSlash } } },
      { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: withSlash.slice(0, -1) } } }
    ];
  });
  const dimensionFilter = { orGroup: { expressions } };
  const metrics = ['activeUsers', 'sessions', 'screenPageViews'].map((name) => ({ name }));

  try {
    const reports = await batch(property, key, [
      { dateRanges: [CURRENT, PREVIOUS], metrics, dimensionFilter },
      {
        dateRanges: [{ startDate: '117daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics,
        dimensionFilter,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 200
      },
      { ...top('sessionDefaultChannelGroup', 'sessions', 8), dimensionFilter }
    ]);
    const totals = (name: string) => {
      const m = reports[0]?.rows?.find((r) => r.dimensionValues?.[0]?.value === name)?.metricValues ?? [];
      return { visitors: num(m[0]?.value), visits: num(m[1]?.value), pageViews: num(m[2]?.value) };
    };
    const byDay = new Map((reports[1]?.rows ?? []).map((r) => [r.dimensionValues?.[0]?.value ?? '', r.metricValues ?? []]));
    const daily: PageStats['daily'] = [];
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) + 'T00:00:00Z');
    for (let i = 117; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      const m = byDay.get(d.replace(/-/g, '')) ?? [];
      daily.push({ date: d, visitors: num(m[0]?.value), visits: num(m[1]?.value), pageViews: num(m[2]?.value) });
    }
    const data: PageStats = {
      current: totals('current'),
      previous: totals('previous'),
      daily,
      channels: shares(reports[2], /^\(not set\)$|^$|^Unassigned$/)
    };
    pageCache.set(cacheKey, { at: Date.now(), data });
    return { data };
  } catch (err) {
    console.error('[analytics] team', err);
    return { data: pageCache.get(cacheKey)?.data ?? null, error: 'Website figures could not be loaded just now.' };
  }
}
