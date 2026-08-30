import { CERTIFICATIONS } from '../data/certifications.js';
import { searchReports, fetchAllFellows, fetchAllCountries } from '../api.js';

/**
 * Every static page worth surfacing in sitewide search - title,
 * description (what's actually searched, along with the title), and
 * the route to link to. Deliberately NOT every route in App.jsx: auth
 * pages (login/signup/verify-*), admin-only pages, and pages reached
 * only via another page's own flow (e.g. /donate/thank-you) don't
 * belong in a general "find content on this site" search - a visitor
 * searching "donate" wants /donate, not a thank-you page they can only
 * reach by actually donating first.
 */
const STATIC_PAGES = [
  { title: 'Home', description: 'International Truth & Trauma Institute', url: '/' },
  { title: 'About', description: 'Our mission, history, and the team behind ITTI.', url: '/about' },
  { title: 'Trauma Observatory', description: 'Interactive globe visualizing collective trauma exposure data across countries (GTBI, ETTI indices).', url: '/observatory' },
  { title: 'Reports', description: 'Published research reports and field bulletins on collective trauma documentation and trauma-informed governance.', url: '/reports' },
  { title: 'Country Profiles', description: 'Trauma burden data and profiles for countries around the world.', url: '/country-profiles' },
  { title: 'Fellowship', description: 'ITTI\'s fellowship program and current fellows.', url: '/fellows' },
  { title: 'Certifications', description: 'Trauma-informed care certification courses and programs.', url: '/certifications' },
  { title: 'Contact', description: 'Get in touch with the International Truth & Trauma Institute.', url: '/contact' },
  { title: 'Documentation', description: 'Reference documentation and methodology notes.', url: '/docs' },
  { title: 'Donate', description: 'Support ITTI\'s work documenting and addressing collective trauma.', url: '/donate' },
];

function matchesQuery(haystack, query) {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Searches static pages + certifications synchronously (both are
 * already-loaded local data, no network needed) and returns results
 * immediately - used to render instantly while the async report/
 * fellow/country searches below are still in flight.
 */
export function searchStaticContent(query, { limit = 5 } = {}) {
  if (!query || !query.trim()) return { pages: [], certifications: [] };
  const q = query.trim();

  const pages = STATIC_PAGES
    .filter((p) => matchesQuery(p.title, q) || matchesQuery(p.description, q))
    .slice(0, limit);

  const certifications = CERTIFICATIONS
    .filter((c) => matchesQuery(c.name, q) || matchesQuery(c.tagline, q) || matchesQuery(c.focus, q))
    .slice(0, limit)
    .map((c) => ({
      title: c.name,
      description: c.tagline,
      url: `/certifications#cert-${c.code}`,
    }));

  return { pages, certifications };
}

// Fellows and countries are both small, fully-loaded datasets (see
// fetchAllFellows/fetchAllCountries's own docstrings) - fetched once and
// cached at module scope rather than re-fetched on every search, since
// neither changes within a single page session and re-fetching on every
// keystroke would be wasteful for data this static.
let fellowsCache = null;
let countriesCache = null;

async function getFellows() {
  if (fellowsCache === null) {
    try {
      fellowsCache = await fetchAllFellows();
    } catch {
      fellowsCache = [];
    }
  }
  return fellowsCache;
}

async function getCountries() {
  if (countriesCache === null) {
    try {
      const data = await fetchAllCountries();
      // Keyed by ISO numeric code (see get_countries()'s own docstring
      // in app.py, and CountryProfiles.jsx's own countries-array-
      // building code for the same key/shape) - flatten to an array
      // with that code preserved (needed for the ?code= deep link
      // below) alongside the country's name for searching.
      countriesCache = Object.entries(data)
        .filter(([, record]) => record && record.name)
        .map(([code, record]) => ({ code, name: record.name }));
    } catch {
      countriesCache = [];
    }
  }
  return countriesCache;
}

/**
 * The full sitewide search - static content (instant) plus reports/
 * fellows/countries (async, via API or cached fetch). Returns a single
 * object grouped by type, each capped at `limit` results, for
 * SearchBar.jsx's dropdown and SearchResultsPage.jsx's full view to
 * render identically from the same shape.
 */
export async function siteSearch(query, { limit = 5 } = {}) {
  const q = (query || '').trim();
  if (!q) {
    return { pages: [], certifications: [], reports: [], fellows: [], countries: [] };
  }

  const { pages, certifications } = searchStaticContent(q, { limit });

  const [reports, fellows, countries] = await Promise.all([
    searchReports(q).catch(() => []),
    getFellows().then((all) =>
      all.filter((f) => matchesQuery(f.name, q) || matchesQuery(f.bio || '', q)).slice(0, limit)
    ),
    getCountries().then((all) => all.filter((c) => matchesQuery(c.name, q)).slice(0, limit)),
  ]);

  return { pages, certifications, reports, fellows, countries };
}
