import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchDeletedReportsAdmin, repostReport, hardDeleteReport } from '../api.js';
import { REPORT_CATEGORIES } from '../constants/reportCategories.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import Modal from '../components/Modal.jsx';
import '../styles/Reports.css';
import '../styles/Control.css';

const PAGE_SIZE = 20;

const DELETED_VIA_LABELS = {
  deletion_review: "Publisher's request, reviewer-approved",
  admin: 'Removed directly by an admin',
};

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Admin-only page at /admin/deleted-reports, linked from the Control
 * tab's Deleted Reports panel (see DeletedReportsControl.jsx). Every
 * report that was published at some point and later soft-deleted -
 * either a publisher's reviewer-approved deletion request, or an
 * admin's direct removal (see Report.deleted_via in
 * server/models/report.py for exactly what's included/excluded; a
 * report deleted while still pending_review/changes_requested/rejected
 * never shows up here, since it was never actually public).
 *
 * Categorized the same way the public Reports page is (a tab per
 * REPORT_CATEGORIES entry) - unlike that page, though, this one drives
 * the category as a server-side filter (GET /api/reports/deleted?
 * category=...) rather than fetching everything and grouping
 * client-side, since the admin's full trash can plausibly be much
 * larger than one category's published reports.
 *
 * Bulk actions: select any number of reports (checkboxes), then either
 * "Repost" (restore_report() - brings back exactly what was there,
 * no re-review) or "Delete permanently" (hard_delete_report() -
 * irreversible, confirmed via a modal since there's no undo).
 */
export default function DeletedReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [reports, setReports] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(new Set());
  const [confirmingHardDelete, setConfirmingHardDelete] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  function load() {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    fetchDeletedReportsAdmin({
      search,
      category: activeCategory === 'all' ? '' : activeCategory,
      limit: PAGE_SIZE,
      offset,
    })
      .then(({ reports: page, total: matchCount }) => {
        setReports(page);
        setTotal(matchCount);
        // Drop any selection that's no longer on the current page -
        // simpler and safer than trying to preserve a selection across
        // an unrelated filter/page change.
        setSelected(new Set());
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeCategory, search, offset]);

  function toggleSelected(reportId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!reports) return;
    setSelected((prev) => (prev.size === reports.length ? new Set() : new Set(reports.map((r) => r.id))));
  }

  async function handleRepostSelected() {
    setActionBusy(true);
    setActionError(null);
    try {
      await Promise.all([...selected].map((id) => repostReport(id)));
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleHardDeleteConfirmed() {
    setActionBusy(true);
    setActionError(null);
    try {
      await Promise.all([...selected].map((id) => hardDeleteReport(id)));
      setConfirmingHardDelete(false);
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <div className="reports-page">
        <SEO path="/admin/deleted-reports" title="Deleted Reports" noindex />
        <div className="reports-content">
          <Link to="/reports" className="page-back-link">
            ← Back to Reports
          </Link>
          <div className="peer-review-gate">
            <h1>You don't have access to this page</h1>
            <p>Viewing deleted reports is limited to admin accounts.</p>
          </div>
        </div>
      </div>
    );
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="reports-page">
      <SEO path="/admin/deleted-reports" title="Deleted Reports" noindex />
      <div className="reports-content">
        <Reveal delay={0}>
          <Link to="/reports" className="page-back-link">
            ← Back to Reports
          </Link>
          <div className="reports-header">
            <div>
              <h1>Deleted Reports</h1>
              <p>
                Reports that were published and later removed. Repost to restore exactly as they were, or delete
                permanently to erase them from the database.
              </p>
            </div>
          </div>
        </Reveal>

        <input
          type="text"
          className="access-level-search"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          aria-label="Search deleted reports by title"
        />

        <nav className="reports-section-nav" aria-label="Report sections">
          <button
            type="button"
            className={`reports-section-tab${activeCategory === 'all' ? ' is-active' : ''}`}
            onClick={() => { setActiveCategory('all'); setOffset(0); }}
            aria-current={activeCategory === 'all' ? 'true' : undefined}
          >
            All sections
          </button>
          {REPORT_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className={`reports-section-tab${category === activeCategory ? ' is-active' : ''}`}
              onClick={() => { setActiveCategory(category); setOffset(0); }}
              aria-current={category === activeCategory ? 'true' : undefined}
            >
              {category}
            </button>
          ))}
        </nav>

        {error && <p className="reports-error">{error}</p>}

        {selected.size > 0 && (
          <div className="control-section deleted-reports-bulk-bar">
            <span>{selected.size} selected</span>
            <button type="button" className="control-btn control-btn--secondary" onClick={handleRepostSelected} disabled={actionBusy}>
              {actionBusy ? 'Working…' : 'Repost selected'}
            </button>
            <button type="button" className="control-btn control-btn--danger" onClick={() => setConfirmingHardDelete(true)} disabled={actionBusy}>
              Delete permanently
            </button>
          </div>
        )}
        {actionError && <p className="reports-error">{actionError}</p>}

        <div className="access-level-table-wrap">
          <table className="access-level-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={reports !== null && reports.length > 0 && selected.size === reports.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </th>
                <th>Title</th>
                <th>Section</th>
                <th>Deleted via</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {!error && loading && reports === null && (
                <tr>
                  <td colSpan={5} className="access-level-empty">Loading deleted reports…</td>
                </tr>
              )}
              {!error && !loading && reports !== null && reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="access-level-empty">
                    {search || activeCategory !== 'all' ? 'No deleted reports match this search/filter.' : 'No reports have been deleted.'}
                  </td>
                </tr>
              )}
              {reports?.map((report) => (
                <tr key={report.id} className={loading ? 'access-level-row--stale' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(report.id)}
                      onChange={() => toggleSelected(report.id)}
                      aria-label={`Select ${report.title}`}
                    />
                  </td>
                  <td>{report.title}</td>
                  <td>{report.category}</td>
                  <td>{DELETED_VIA_LABELS[report.deleted_via] || report.deleted_via}</td>
                  <td>{formatDate(report.updated_at)}</td>
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
            disabled={offset === 0 || loading}
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
            disabled={offset + PAGE_SIZE >= total || loading}
          >
            Next
          </button>
        </div>
      </div>

      {confirmingHardDelete && (
        <Modal
          title="Delete permanently"
          onClose={actionBusy ? undefined : () => setConfirmingHardDelete(false)}
          footer={
            <>
              <button type="button" className="app-modal-btn" onClick={() => setConfirmingHardDelete(false)} disabled={actionBusy}>
                Cancel
              </button>
              <button type="button" className="app-modal-btn app-modal-btn--primary" onClick={handleHardDeleteConfirmed} disabled={actionBusy}>
                {actionBusy ? 'Deleting…' : `Delete ${selected.size} permanently`}
              </button>
            </>
          }
        >
          <p>
            This erases {selected.size} report{selected.size === 1 ? '' : 's'} and their files from the database
            entirely. This cannot be undone - repost is no longer possible once this is done.
          </p>
        </Modal>
      )}
    </div>
  );
}