import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportCard from '../components/ReportCard.jsx';
import { fetchFavoriteReportIds, favoriteReport, unfavoriteReport, requestReportDeletion, csrfFetch } from '../api.js';
import { REPORT_CATEGORIES } from '../constants/reportCategories.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import DeleteReportModal from '../components/DeleteReportModal.jsx';
import { isBadRequest } from '../utils/apiError';
import '../styles/Reports.css';

/**
 * The actual report browser - category tabs, pager, grid - reachable
 * at /reports/browse. Split out of Reports.jsx (which is now a plain
 * landing page with three CTA cards: "See the reports" links here,
 * "Publish a report" links to /reports/publish, "Peer review" links
 * to /peer-review) so all three behave the same way: a real,
 * shareable/bookmarkable page you navigate to, not one of the three
 * expanding in place while the other two navigate away. Individually
 * reading one report still happens on its own page too - see
 * ReportCard's onRead below, which goes to /reports/:id.
 */
export default function ReportsBrowse() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const { user, isAuthenticated } = useAuth();
  const [reports, setReports] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [deletingReport, setDeletingReport] = useState(null); // the report a delete/request-deletion modal is open for
  const [activeCategory, setActiveCategory] = useState(REPORT_CATEGORIES[0]);

  // Server-side enforcement is @roles_required("publisher", "admin") on
  // POST/DELETE /api/reports - this is only the UX layer that decides
  // whether to show report-management controls (delete) on a card.
  // Deliberately checks role directly rather than AuthContext's
  // isPublisher, since isPublisher doesn't currently include admin.
  const canManageReports = user?.role === 'publisher' || user?.role === 'admin';

  async function loadReports() {
    try {
      // This page loads every published report up front and groups/counts
      // them by category client-side for instant tab-switching, rather
      // than re-fetching per category - so it needs everything in one
      // response, not the default page. GET /api/reports is capped at
      // pagination.DEFAULT_PAGE_SIZE (100) unless ?limit= says otherwise,
      // so without this the category tabs/counts would silently go
      // wrong (missing/undercounted reports) the moment the site passes
      // 100 published reports - MAX_PAGE_SIZE (200, server-enforced) is
      // the most this endpoint will ever return in one call. Past 200
      // published reports this page needs real pagination (e.g. fetch
      // per active category instead of everything at once) - it doesn't
      // have that today.
      const res = await fetch('/api/reports?limit=200');
      if (isBadRequest(res)) {
        navigate('/unavailable?from=%2Freports%2Fbrowse&fromLabel=Back%20to%20Reports');
        return;
      }
      if (!res.ok) throw new Error('Failed to load reports.');
      setReports(await res.json());
    } catch (err) {
      setLoadError(err.message);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

  // Coming from a ?highlight=<id> link: the list is split into
  // category sections, and the highlighted report might not be in
  // whichever one is active by default - this jumps activeCategory to
  // wherever it actually lives first, so its card exists in the DOM at
  // all, before the effect below tries to scroll to it.
  useEffect(() => {
    if (!highlightId || reports === null) return;
    const match = reports.find((r) => String(r.id) === highlightId);
    if (match) setActiveCategory(match.category);
  }, [highlightId, reports]);

  useEffect(() => {
    if (!highlightId || reports === null) return;
    const el = document.getElementById(`report-${highlightId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, reports, activeCategory]);

  // Favorite state is a separate load, gated on being logged in at all -
  // a logged-out visitor simply never sees any star as filled (and
  // ReportCard hides the star entirely for them - see onToggleFavorite
  // being undefined below).
  useEffect(() => {
    if (!isAuthenticated) {
      setFavoriteIds(new Set());
      return;
    }
    fetchFavoriteReportIds()
      .then((ids) => setFavoriteIds(new Set(ids)))
      .catch(() => {}); // non-critical - stars just won't show as filled
  }, [isAuthenticated]);

  // /api/reports already returns newest-created first (see
  // get_published_reports in models/report.py) - grouping by category
  // here is a pure filter over that list, so within each section the
  // creation-date order carries through untouched rather than being
  // re-sorted.
  const reportsByCategory = useMemo(() => {
    const grouped = new Map(REPORT_CATEGORIES.map((c) => [c, []]));
    for (const report of reports || []) {
      if (grouped.has(report.category)) {
        grouped.get(report.category).push(report);
      }
    }
    return grouped;
  }, [reports]);

  const activeIndex = REPORT_CATEGORIES.indexOf(activeCategory);
  const activeReports = reportsByCategory.get(activeCategory) || [];

  function goToSection(offset) {
    const nextIndex = (activeIndex + offset + REPORT_CATEGORIES.length) % REPORT_CATEGORIES.length;
    setActiveCategory(REPORT_CATEGORIES[nextIndex]);
  }

  async function handleToggleFavorite(reportId, currentlyFavorited) {
    // Optimistic update - toggling a favorite is low-stakes enough that
    // waiting on the round-trip before reflecting it would feel laggy.
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (currentlyFavorited) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
    try {
      if (currentlyFavorited) await unfavoriteReport(reportId);
      else await favoriteReport(reportId);
    } catch {
      // Revert on failure.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (currentlyFavorited) next.add(reportId);
        else next.delete(reportId);
        return next;
      });
    }
  }

  async function handleInstantDelete(reportId) {
    const res = await csrfFetch(`/api/reports/${reportId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      loadReports();
    } else {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.description || data.error || 'Could not delete report.');
    }
  }

  async function handleRequestDeletion(reportId, reason) {
    await requestReportDeletion(reportId, reason);
    loadReports(); // review_status is now "deletion_requested" - the card/badge should reflect that immediately
  }

  return (
    <div className="reports-page">
      <SEO
        path="/reports/browse"
        title="Browse Reports"
        description="Published research reports and field bulletins from the International Truth & Trauma Institute, covering collective trauma documentation and trauma-informed governance."
      />
      <div className="reports-content">
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <Reveal delay={0}>
          <div className="reports-header">
            <div>
              <h1 className="display">Browse Reports</h1>
              <p>Published research reports and field bulletins, by section.</p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={30}>
          <div className="reports-browser">
            {loadError && <p className="reports-error">{loadError}</p>}
            {!loadError && reports === null && <p className="reports-status">Loading reports…</p>}

            {!loadError && reports !== null && (
              <>
                <nav className="reports-section-nav" aria-label="Report sections">
                  {REPORT_CATEGORIES.map((category) => {
                    const count = reportsByCategory.get(category)?.length || 0;
                    return (
                      <button
                        key={category}
                        type="button"
                        className={`reports-section-tab${category === activeCategory ? ' is-active' : ''}`}
                        onClick={() => setActiveCategory(category)}
                        aria-current={category === activeCategory ? 'true' : undefined}
                      >
                        {category}
                        <span className="reports-section-tab-count">{count}</span>
                      </button>
                    );
                  })}
                </nav>

                <div className="reports-section-pager">
                  <button type="button" className="reports-section-pager-btn" onClick={() => goToSection(-1)}>
                    ← Previous section
                  </button>
                  <span className="reports-section-pager-position">
                    Section {activeIndex + 1} of {REPORT_CATEGORIES.length}
                  </span>
                  <button type="button" className="reports-section-pager-btn" onClick={() => goToSection(1)}>
                    Next section →
                  </button>
                </div>

                <div key={activeCategory}>
                  <h3 className="reports-section-heading">{activeCategory}</h3>
                  {activeReports.length === 0 ? (
                    <p className="reports-status">No reports have been published in this section yet.</p>
                  ) : (
                    <div className="reports-grid">
                      {activeReports.map((report) => (
                        <div
                          key={report.id}
                          id={`report-${report.id}`}
                          className={String(report.id) === highlightId ? 'reports-card-highlight' : undefined}
                        >
                          <ReportCard
                            report={report}
                            canManage={canManageReports && (user?.role === 'admin' || user?.id === report.uploaded_by)}
                            onDelete={setDeletingReport}
                            isFavorited={favoriteIds.has(report.id)}
                            onToggleFavorite={isAuthenticated ? handleToggleFavorite : undefined}
                            onRead={(r) => navigate(`/reports/${r.id}`)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Reveal>
      </div>

      {deletingReport && (
        <DeleteReportModal
          report={deletingReport}
          canInstantDelete={user?.role === 'admin'}
          onInstantDelete={() => handleInstantDelete(deletingReport.id)}
          onRequestDeletion={(reason) => handleRequestDeletion(deletingReport.id, reason)}
          onClose={() => setDeletingReport(null)}
        />
      )}
    </div>
  );
}