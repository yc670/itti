import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { favoriteReport, unfavoriteReport, fetchFavoriteReportIds, requestReportDeletion } from '../api.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import DeleteReportModal from '../components/DeleteReportModal.jsx';
import { isBadRequest } from '../utils/apiError';
import '../styles/Reports.css';

/**
 * Standalone page for reading a single report - a real route
 * (/reports/:id) with its own URL, rather than a modal ReportViewerModal
 * used to open on top of /reports. That modal made "read a report" feel
 * like expanding the Reports page in place: no shareable/bookmarkable
 * URL for a specific report, no browser back button to return to the
 * list, and the address bar never actually changed. This page fixes
 * all three - Reports.jsx's "Read" button now navigates here instead
 * of opening ReportViewerModal, which was deleted (see this page's own
 * viewer logic below, carried over from that component almost
 * unchanged).
 *
 * PDFs are handed to the browser's own PDF viewer via an <iframe>.
 * DOCX has no native browser renderer, so it's fetched as bytes and
 * converted to HTML client-side with mammoth - reasonable-fidelity
 * (headings, lists, bold/italic, paragraphs), not pixel-faithful to
 * Word; Download covers anyone who needs the exact original. Legacy
 * .doc can't be converted by mammoth (only understands .docx's XML
 * format), so it falls back to a "no inline preview" message.
 */
export default function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [report, setReport] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [docState, setDocState] = useState({ status: 'loading', html: null, error: null });
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [deletingReport, setDeletingReport] = useState(false); // just a flag here - only one report on this page

  const fileUrl = report ? `/api/reports/${report.id}/file` : null;
  const isPdf = report?.file_type === 'pdf';
  const isDocx = report?.file_type === 'docx';

  const canManage =
    Boolean(report) &&
    (user?.role === 'admin' || (['publisher', 'reviewer'].includes(user?.role) && user?.id === report.uploaded_by));

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setLoadError(null);

    fetch(`/api/reports/${id}`)
      .then((res) => {
        if (isBadRequest(res)) {
          navigate(`/unavailable?from=%2Freports&fromLabel=Back%20to%20Reports`);
          return null;
        }
        if (res.status === 404) throw new Error('This report could not be found, or is not available to view.');
        if (!res.ok) throw new Error('Failed to load this report.');
        return res.json();
      })
      .then((data) => {
        if (cancelled || data == null) return;
        setReport(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  // Favorite state for this one report - a lighter-weight version of
  // Reports.jsx's Set-of-all-favorite-ids approach, since this page only
  // ever needs to know about a single report's status.
  useEffect(() => {
    if (!isAuthenticated || !report) {
      setIsFavorited(false);
      return;
    }
    let cancelled = false;
    fetchFavoriteReportIds()
      .then((ids) => {
        if (!cancelled) setIsFavorited(ids.includes(report.id));
      })
      .catch(() => {}); // non-critical - star just won't show as filled
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, report]);

  useEffect(() => {
    if (!isDocx || !fileUrl) return;
    let cancelled = false;
    setDocState({ status: 'loading', html: null, error: null });

    (async () => {
      try {
        const res = await fetch(fileUrl, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not load this report.');
        const arrayBuffer = await res.arrayBuffer();
        // Loaded lazily - mammoth is only needed on this one page, no
        // reason to add it to every page's initial bundle.
        const mammoth = await import('mammoth');
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setDocState({ status: 'ready', html, error: null });
      } catch (err) {
        if (!cancelled) {
          setDocState({ status: 'error', html: null, error: err.message || 'Could not render this document.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, isDocx]);

  async function handleToggleFavorite() {
    if (!report || favoriteBusy) return;
    const next = !isFavorited;
    setIsFavorited(next); // optimistic, same as Reports.jsx
    setFavoriteBusy(true);
    try {
      if (next) await favoriteReport(report.id);
      else await unfavoriteReport(report.id);
    } catch {
      setIsFavorited(!next); // revert on failure
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function handleInstantDelete() {
    const res = await fetch(`/api/reports/${report.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      navigate('/reports');
    } else {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.description || data.error || 'Could not delete report.');
    }
  }

  async function handleRequestDeletion(reason) {
    const updated = await requestReportDeletion(report.id, reason);
    setReport(updated); // stays on this page - the report is still visible (review_status is now "deletion_requested")
  }

  return (
    <div className="reports-page">
      <SEO
        path={`/reports/${id}`}
        title={report ? report.title : 'Report'}
        description={
          report
            ? report.description
            : 'A published research report or field bulletin from the International Truth & Trauma Institute.'
        }
      />
      <div className="reports-content report-view-content">
        <Reveal delay={0}>
          <Link to="/reports" className="page-back-link">
            ← Back to Reports
          </Link>
        </Reveal>

        {loadError && <p className="reports-error">{loadError}</p>}
        {!loadError && report === null && <p className="reports-status">Loading report…</p>}

        {!loadError && report !== null && (
          <Reveal delay={20}>
            <div className="report-view-page">
              <div className="report-view-header">
                <div className="report-view-header-text">
                  <h1 className="report-view-title" title={report.title}>{report.title}</h1>
                  <p className="report-view-author">By {report.author} · {report.category}</p>
                  {report.review_status === 'deletion_requested' && (
                    <p className="deletion-requested-banner">
                      Deletion requested - awaiting a reviewer's decision. It stays published until then.
                    </p>
                  )}
                </div>
                <div className="report-view-header-actions">
                  {isAuthenticated && (
                    <button
                      type="button"
                      className={`report-card-favorite${isFavorited ? ' is-favorited' : ''}`}
                      onClick={handleToggleFavorite}
                      disabled={favoriteBusy}
                      aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFavorited ? '★' : '☆'}
                    </button>
                  )}
                  <a
                    className="report-viewer-download"
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
                  {canManage && (
                    <button type="button" className="report-card-delete" onClick={() => setDeletingReport(true)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="report-view-body">
                {isPdf && (
                  <iframe className="report-viewer-pdf-frame" src={fileUrl} title={report.title} />
                )}

                {isDocx && docState.status === 'loading' && (
                  <p className="report-viewer-status">Loading document…</p>
                )}
                {isDocx && docState.status === 'error' && (
                  <p className="report-viewer-status report-viewer-status--error">{docState.error}</p>
                )}
                {isDocx && docState.status === 'ready' && (
                  <div className="report-viewer-docx" dangerouslySetInnerHTML={{ __html: docState.html }} />
                )}

                {!isPdf && !isDocx && (
                  <p className="report-viewer-status">
                    No inline preview is available for this file type. Use Download above instead.
                  </p>
                )}
              </div>
            </div>
          </Reveal>
        )}
      </div>

      {deletingReport && report && (
        <DeleteReportModal
          report={report}
          canInstantDelete={user?.role === 'admin'}
          onInstantDelete={handleInstantDelete}
          onRequestDeletion={handleRequestDeletion}
          onClose={() => setDeletingReport(false)}
        />
      )}
    </div>
  );
}