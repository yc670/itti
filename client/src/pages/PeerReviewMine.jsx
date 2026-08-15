import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportCard from '../components/ReportCard.jsx';
import PeerReviewPanel from '../components/PeerReviewPanel.jsx';
import PublisherAccessGate from '../components/PublisherAccessGate.jsx';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/PeerReview.css';

/**
 * "My Submissions" - the reports the logged-in user has uploaded
 * themselves, at every review_status (pending, published, rejected),
 * reachable at /peer-review/mine. Same self-guard pattern as
 * PeerReview.jsx (see PublisherAccessGate.jsx) since it's linked from
 * the same places and needs the same login/access-level messaging.
 *
 * Reads GET /api/reports/mine (any review_status, this user's own)
 * rather than filtering the shared /api/reports/pending list, so a
 * report shows up here the moment it's uploaded and stays visible
 * after it resolves either way - the same PeerReviewPanel used on the
 * shared queue renders its progress/comments here too, so a decision
 * made on the "Awaiting Review" page is reflected here as soon as this
 * page is loaded or reloaded (both pages read from the same server
 * records - there's no separate state to keep in sync).
 *
 * Deleting a report here (ReportCard's own Delete button, shown since
 * canManage is true for every report on this page - it's always the
 * viewer's own) soft-deletes it via the same DELETE /api/reports/<id>
 * used everywhere else, which also removes it from the shared queue.
 */
export default function PeerReviewMine() {
  const { user, isAuthenticated, isPublisher, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [mine, setMine] = useState(null);
  const [error, setError] = useState(null);

  function loadMine() {
    fetch('/api/reports/mine', { credentials: 'include' })
      .then((res) => res.json())
      .then(setMine)
      .catch(() => setError('Could not load your submissions.'));
  }

  useEffect(() => {
    if (isAuthenticated && isPublisher) loadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isPublisher]);

  useEffect(() => {
    if (!highlightId || mine === null) return;
    const el = document.getElementById(`peer-review-report-${highlightId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, mine]);

  function handleDecided() {
    loadMine();
  }

  async function handleDelete(reportId) {
    const res = await fetch(`/api/reports/${reportId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      loadMine();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.description || data.error || 'Could not remove report.');
    }
  }

  if (authLoading) return null;

  if (!isAuthenticated || !isPublisher) {
    return (
      <div className="peer-review-page">
        <SEO path="/peer-review/mine" title="My Submissions" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <PublisherAccessGate isAuthenticated={isAuthenticated} fromPath="/peer-review/mine" />
      </div>
    );
  }

  const pendingCount = (mine || []).filter((r) => r.review_status === 'pending_review').length;

  return (
    <div className="peer-review-page">
      <SEO path="/peer-review/mine" title="My Submissions" noindex />
      <Link to="/reports" className="page-back-link">
        ← Back to Reports
      </Link>
      <Reveal delay={0}>
        <div className="peer-review-header">
          <div>
            <h2 className="display">My Submissions</h2>
            <p>Reports you've uploaded and how they're doing in peer review.</p>
          </div>
        </div>
      </Reveal>

      <nav className="peer-review-nav" aria-label="Peer review sections">
        <Link className="peer-review-nav-tab" to="/peer-review">
          Awaiting Review
        </Link>
        <span className="peer-review-nav-tab is-active">My Submissions</span>
      </nav>

      {error && <p className="peer-review-error">{error}</p>}

      <Reveal delay={30}>
        <section className="peer-review-section">
          {mine === null && !error && <p className="peer-review-status">Loading…</p>}
          {mine !== null && mine.length === 0 && (
            <p className="peer-review-status">
              You haven't uploaded anything yet. <Link to="/reports/publish">Publish a report</Link> to get started.
            </p>
          )}
          {mine !== null && mine.length > 0 && (
            <>
              <p className="peer-review-section-desc">
                {pendingCount} of {mine.length} submission{mine.length === 1 ? '' : 's'} still awaiting review.
              </p>
              <div className="peer-review-list">
                {mine.map((report) => (
                  <div
                    key={report.id}
                    id={`peer-review-report-${report.id}`}
                    className={`peer-review-item${String(report.id) === highlightId ? ' peer-review-item-highlight' : ''}`}
                  >
                    <ReportCard report={report} canManage onDelete={handleDelete} onRead={(r) => navigate(`/reports/${r.id}`)} />
                    <PeerReviewPanel report={report} currentUser={user} onDecided={handleDecided} />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </Reveal>
    </div>
  );
}