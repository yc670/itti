import { useEffect, useRef, useState } from 'react';
import { fetchAllReportsAdmin, updateReportCategory } from '../api.js';
import { REPORT_CATEGORIES } from '../constants/reportCategories.js';

const PAGE_SIZE = 20;

const REVIEW_STATUS_LABELS = {
  pending_review: 'Pending review',
  changes_requested: 'Changes requested',
  published: 'Published',
  rejected: 'Rejected',
};

/**
 * Admin-only report list backing the Control tab's "recategorize an
 * existing report" tool - search by title, optionally filter to one
 * category, change a report's category straight from its row's
 * dropdown (confirmed via a modal before it's sent). Deliberately the
 * same shape as AccessLevelPanel.jsx (search + paginated table +
 * per-row dropdown + confirm modal) since it's the same interaction
 * pattern applied to reports/category instead of users/role.
 *
 * Exists to fix reports that were miscategorized before upload_report()
 * was corrected to actually read the submitted category instead of
 * silently defaulting every report to "National Trauma Assessment" -
 * see that route's own docstring/history. Lists reports across EVERY
 * review_status (not just published) and includes hidden ones, since
 * the bug affected reports at every stage equally and an admin fixing
 * categories shouldn't have any of them invisible here.
 */
export default function ReportCategoryControl() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The change a row's dropdown just proposed, awaiting confirmation - or
  // null when no modal should show. { report, newCategory }
  const [pendingChange, setPendingChange] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetchAllReportsAdmin({ search, category: categoryFilter, limit: PAGE_SIZE, offset })
      .then(({ reports: page, total: matchCount }) => {
        if (requestId !== requestIdRef.current) return; // a newer request already landed
        setReports(page);
        setTotal(matchCount);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err.message);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [search, categoryFilter, offset]);

  function handleSearchChange(e) {
    setSearch(e.target.value);
    setOffset(0); // a changed search always starts back at page 1
  }

  function handleCategoryFilterChange(e) {
    setCategoryFilter(e.target.value);
    setOffset(0);
  }

  function handleCategorySelect(report, newCategory) {
    if (newCategory === report.category) return;
    setSaveError(null);
    setPendingChange({ report, newCategory });
  }

  function cancelChange() {
    if (saving) return;
    setPendingChange(null);
    setSaveError(null);
  }

  async function confirmChange() {
    if (!pendingChange) return;
    const { report, newCategory } = pendingChange;
    setSaving(true);
    setSaveError(null);
    try {
      await updateReportCategory(report.id, newCategory);
      // A report that no longer matches the active category filter
      // should disappear from this page rather than show a stale
      // category - simplest correct way to do that is to just drop it
      // from local state; the total count is refreshed on the next
      // fetch (search/filter/page change) rather than adjusted here.
      if (categoryFilter && newCategory !== categoryFilter) {
        setReports((prev) => prev.filter((r) => r.id !== report.id));
      } else {
        setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, category: newCategory } : r)));
      }
      setPendingChange(null);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrev = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <section className="control-section access-level-panel">
      <h3>Report categories</h3>
      <p className="control-section-desc">
        Search for a report by title, then pick a new section from its dropdown to recategorize
        it. Works on reports at any review stage, including ones already published - this does
        not send a report back through peer review.
      </p>

      <div className="access-level-search-row">
        <input
          type="text"
          className="access-level-search"
          placeholder="Search by title…"
          value={search}
          onChange={handleSearchChange}
          aria-label="Search reports by title"
        />
        <select
          className="access-level-search"
          value={categoryFilter}
          onChange={handleCategoryFilterChange}
          aria-label="Filter by current section"
        >
          <option value="">All sections</option>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {error && <p className="control-status control-status--error">{error}</p>}

      <div className="access-level-table-wrap">
        <table className="access-level-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Section</th>
            </tr>
          </thead>
          <tbody>
            {!error && loading && reports.length === 0 && (
              <tr>
                <td colSpan={3} className="access-level-empty">Loading reports…</td>
              </tr>
            )}
            {!error && !loading && reports.length === 0 && (
              <tr>
                <td colSpan={3} className="access-level-empty">
                  {search || categoryFilter ? 'No reports match this search/filter.' : 'No reports found.'}
                </td>
              </tr>
            )}
            {reports.map((report) => (
              <tr key={report.id} className={loading ? 'access-level-row--stale' : undefined}>
                <td>{report.title}</td>
                <td>{REVIEW_STATUS_LABELS[report.review_status] || report.review_status}</td>
                <td>
                  <select
                    className="access-level-select"
                    value={report.category}
                    onChange={(e) => handleCategorySelect(report, e.target.value)}
                    disabled={saving}
                    aria-label={`Section for ${report.title}`}
                  >
                    {REPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="access-level-pagination">
        <button
          type="button"
          className="control-btn control-btn--secondary"
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          disabled={!canGoPrev || loading}
        >
          Previous
        </button>
        <span className="access-level-page-info">
          Page {page} of {pageCount} · {total} report{total === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="control-btn control-btn--secondary"
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          disabled={!canGoNext || loading}
        >
          Next
        </button>
      </div>

      {pendingChange && (
        <div className="access-level-modal-overlay" role="presentation" onClick={cancelChange}>
          <div
            className="access-level-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-category-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="report-category-modal-title">Confirm section change</h4>
            <p>
              Move <strong>{pendingChange.report.title}</strong> from{' '}
              <strong>{pendingChange.report.category}</strong> to{' '}
              <strong>{pendingChange.newCategory}</strong>?
            </p>
            {saveError && <p className="control-status control-status--error">{saveError}</p>}
            <div className="access-level-modal-actions">
              <button type="button" className="control-btn control-btn--secondary" onClick={cancelChange} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="control-btn" onClick={confirmChange} disabled={saving}>
                {saving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}