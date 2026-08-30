import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportCard from '../components/ReportCard.jsx';
import DeletionReviewPanel from '../components/DeletionReviewPanel.jsx';
import { fetchDeletionRequestedReports } from '../api.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/PeerReview.css';

/**
 * Deletion Requests - the third tab on the Peer Review page, reachable
 * at /peer-review/deletions. Reviewer/admin only (NOT publisher, unlike
 * the other two Peer Review tabs) - deciding a deletion request is
 * specifically the reviewer tier's defining power (see
 * docs/ACCESS_LEVELS.md's "Report deletion" section), while publishers
 * only ever appear here as the requester, not the decider.
 *
 * Reads GET /api/reports/deletion-requests, oldest request first (same
 * "longest waiting" ordering as the Awaiting Review tab). A decision
 * (approve/deny) is final immediately - no vote counting, unlike the
 * publish workflow - so a report leaves this list the moment anyone
 * decides it, same reload-on-decision pattern as PeerReview.jsx.
 */
export default function PeerReviewDeletions() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isReviewer = user?.role === 'reviewer' || user?.role === 'admin';
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  function loadRequests() {
    fetchDeletionRequestedReports()
      .then(({ reports }) => setRequests(reports))
      .catch(() => setError('Could not load deletion requests.'));
  }

  useEffect(() => {
    if (isAuthenticated && isReviewer) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isReviewer]);

  useEffect(() => {
    if (!highlightId || requests === null) return;
    const el = document.getElementById(`peer-review-report-${highlightId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, requests]);

  function handleDecided() {
    loadRequests();
  }

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="peer-review-page">
        <SEO path="/peer-review/deletions" title="Deletion Requests" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="peer-review-gate">
          <h1>Log in to review deletion requests</h1>
          <p>You need reviewer or admin access to decide a publisher's request to delete their own report.</p>
          <Link className="btn btn-primary" to="/login" state={{ from: { pathname: '/peer-review/deletions' } }}>
            Log in
          </Link>
        </div>
      </div>
    );
  }

  if (!isReviewer) {
    return (
      <div className="peer-review-page">
        <SEO path="/peer-review/deletions" title="Deletion Requests" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="peer-review-gate">
          <h1>You don't have access to this page</h1>
          <p>
            Deciding deletion requests is limited to accounts with reviewer or admin access. Your current account
            doesn't have that access level yet.
          </p>
          <p>
            To request an upgrade, contact{' '}
            <a href="mailto:support@ittiglobal.org">support@ittiglobal.org</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="peer-review-page">
      <SEO path="/peer-review/deletions" title="Deletion Requests" noindex />
      <Reveal delay={0}>
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="peer-review-header">
          <div>
            <h2 className="display">Deletion Requests</h2>
            <p>
              A publisher's request to delete their own published report. One reviewer or admin decision is final -
              approving removes it from the public Reports page, denying keeps it published.
            </p>
          </div>
        </div>
      </Reveal>

      <nav className="peer-review-nav" aria-label="Peer review sections">
        <Link className="peer-review-nav-tab" to="/peer-review">
          Awaiting Review
        </Link>
        <Link className="peer-review-nav-tab" to="/peer-review/mine">
          My Submissions
        </Link>
        <span className="peer-review-nav-tab is-active">Deletion Requests</span>
      </nav>

      {error && <p className="peer-review-error">{error}</p>}

      <Reveal delay={30}>
        <section className="peer-review-section">
          {requests === null && !error && <p className="peer-review-status">Loading…</p>}
          {requests !== null && requests.length === 0 && (
            <p className="peer-review-status">No deletion requests are awaiting a decision right now.</p>
          )}
          {requests !== null && requests.length > 0 && (
            <div className="peer-review-list">
              {requests.map((report) => (
                <div
                  key={report.id}
                  id={`peer-review-report-${report.id}`}
                  className={`peer-review-item${String(report.id) === highlightId ? ' peer-review-item-highlight' : ''}`}
                >
                  <ReportCard report={report} onRead={(r) => navigate(`/reports/${r.id}`)} />
                  <DeletionReviewPanel report={report} currentUser={user} onDecided={handleDecided} />
                </div>
              ))}
            </div>
          )}
        </section>
      </Reveal>
    </div>
  );
}