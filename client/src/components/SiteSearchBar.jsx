import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { siteSearch } from '../utils/siteSearch.js';

const DEBOUNCE_MS = 250;

const GROUP_LABELS = {
  pages: 'Pages',
  reports: 'Reports',
  fellows: 'Fellows',
  countries: 'Country Profiles',
  certifications: 'Certifications',
};

/**
 * Sitewide search - a search icon in the navbar that expands into an
 * input with a live results dropdown, grouped by content type (see
 * siteSearch.js for what's actually searched and why). Named
 * SiteSearchBar rather than SearchBar specifically to avoid colliding
 * with the existing SearchBar.jsx, which is a different, unrelated
 * component (the Home/Header globe's own country-search box, searching
 * GeoJSON features - not sitewide content at all).
 *
 * Debounced (250ms) since every keystroke triggers a real network
 * request for the reports portion of the search (see searchReports()
 * in api.js) - firing that on every single keystroke without a
 * debounce would be wasteful and could feel laggy under real network
 * conditions.
 */
export default function SiteSearchBar() {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = no search run yet
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setIsExpanded(false);
      }
    }
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (isExpanded) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isExpanded]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const data = await siteSearch(trimmed, { limit: 4 });
      setResults(data);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function handleToggle() {
    setIsExpanded((prev) => !prev);
  }

  function handleResultClick(url) {
    setIsExpanded(false);
    setQuery('');
    setResults(null);
    navigate(url);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsExpanded(false);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  const groups = results
    ? Object.entries(results).filter(([, items]) => items.length > 0)
    : [];
  const hasAnyResults = groups.length > 0;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="site-search" ref={wrapRef}>
      <button
        type="button"
        className="site-search-toggle"
        onClick={handleToggle}
        aria-label={isExpanded ? 'Close search' : 'Search the site'}
        aria-expanded={isExpanded}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {isExpanded && (
        <div className="site-search-panel">
          <form onSubmit={handleSubmit} className="site-search-form">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search reports, fellows, countries…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </form>

          {hasQuery && (
            <div className="site-search-results">
              {loading && results === null && (
                <p className="site-search-status">Searching…</p>
              )}
              {!loading && !hasAnyResults && results !== null && (
                <p className="site-search-status">No results for "{query.trim()}".</p>
              )}
              {groups.map(([type, items]) => (
                <div key={type} className="site-search-group">
                  <p className="site-search-group-label">{GROUP_LABELS[type]}</p>
                  {items.map((item) => (
                    <button
                      type="button"
                      key={item.url ?? item.id}
                      className="site-search-result"
                      onClick={() =>
                        handleResultClick(
                          type === 'reports'
                            ? `/reports/${item.id}`
                            : type === 'fellows'
                            ? `/fellows`
                            : type === 'countries'
                            ? `/country-profiles?code=${item.code}`
                            : item.url
                        )
                      }
                    >
                      <span className="site-search-result-title">
                        {type === 'reports' || type === 'fellows' ? item.title || item.name : item.title}
                      </span>
                      <span className="site-search-result-desc">
                        {type === 'reports'
                          ? item.description
                          : type === 'fellows'
                          ? item.bio
                          : item.description}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {hasAnyResults && (
                <button type="button" className="site-search-see-all" onClick={handleSubmit}>
                  See all results for "{query.trim()}" →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
