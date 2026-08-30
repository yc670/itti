import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { siteSearch } from '../utils/siteSearch.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/SearchResults.css';

const GROUP_LABELS = {
  pages: 'Pages',
  reports: 'Reports',
  fellows: 'Fellows',
  countries: 'Country Profiles',
  certifications: 'Certifications',
};

// More generous than SiteSearchBar's dropdown (4) - this is the actual
// full-results page, not a preview.
const RESULTS_PER_GROUP = 10;

function resultLink(type, item) {
  if (type === 'reports') return `/reports/${item.id}`;
  if (type === 'fellows') return '/fellows';
  if (type === 'countries') return `/country-profiles?code=${item.code}`;
  return item.url;
}

function resultTitle(type, item) {
  return type === 'fellows' ? item.name : item.title;
}

function resultDescription(type, item) {
  if (type === 'fellows') return item.bio;
  return item.description;
}

/**
 * Full results page at /search?q=..., reached from SiteSearchBar.jsx's
 * "See all results" link (or a submitted search directly, or a shared/
 * bookmarked URL - the query lives in the URL itself via useSearchParams,
 * not component state, specifically so this page works when linked to
 * directly rather than only when navigated to from the search bar).
 *
 * Same siteSearch() call and GROUP_LABELS as the dropdown, just with a
 * higher per-group limit (10 instead of 4) since this is the actual
 * full-results view, not a preview.
 */
export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [inputValue, setInputValue] = useState(query);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInputValue(query);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    siteSearch(query, { limit: RESULTS_PER_GROUP }).then((data) => {
      if (!cancelled) {
        setResults(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) setSearchParams({ q: trimmed });
  }

  const groups = results ? Object.entries(results).filter(([, items]) => items.length > 0) : [];
  const hasAnyResults = groups.length > 0;

  return (
    <div className="search-results-page">
      <SEO path="/search" title={query ? `Search: ${query}` : 'Search'} noindex />
      <div className="search-results-content">
        <Reveal delay={0}>
          <div>
            <h1>Search</h1>
            <form onSubmit={handleSubmit} className="search-results-form">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Search reports, fellows, countries…"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary">Search</button>
            </form>
          </div>
        </Reveal>

        {!query.trim() && (
          <p className="search-results-status">Enter a search term above.</p>
        )}

        {query.trim() && loading && results === null && (
          <p className="search-results-status">Searching…</p>
        )}

        {query.trim() && !loading && !hasAnyResults && (
          <p className="search-results-status">No results for "{query}".</p>
        )}

        {groups.map(([type, items]) => (
          <Reveal key={type} delay={20}>
            <section className="search-results-group">
              <h2>{GROUP_LABELS[type]}</h2>
              <div className="search-results-list">
                {items.map((item) => (
                  <Link
                    key={item.url ?? item.id}
                    to={resultLink(type, item)}
                    className="search-result-card"
                  >
                    <span className="search-result-title">{resultTitle(type, item)}</span>
                    {resultDescription(type, item) && (
                      <span className="search-result-desc">{resultDescription(type, item)}</span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
