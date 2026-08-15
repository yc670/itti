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
 * Peer Review queue - "all pending reports to be reviewed" across
 * every publisher, reachable at /peer-review. Not wrapped in
 * <ProtectedRoute> - it does its own auth/role check via
 * PublisherAccessGate so a signed-out visitor or a non-publisher sees
 * an explanation instead of a silent redirect (see the comment atop
 * PublisherAccessGate.jsx). Server-side enforcement is the real gate
 * (@roles_required("publisher", "admin") on every /api/reports/...
 * review endpoint).
 *
 * Paired with PeerReviewMine.jsx ("My Submissions", /peer-review/mine)
 * - both pages read the same GET /api/reports/pending /
 * /api/reports/mine data and the same PeerReviewPanel component, so a
 * decision made here (approve/disapprove) is reflected on the
 * uploader's own page the next time they load or revisit it - there's
 * no separate state to keep in sync, just the same server records
 * viewed two ways.
 */
export default function PeerReview() {
  const { user, isAuthenticated, isPublisher, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  function loadPending() {
    fetch('/api/reports/pending', { credentials: 'include' })
      .then((res) => res.json())
      .then(setPending)
      .catch(() => setError('Could not load reports awaiting review.'));
  }

  useEffect(() => {
    if (isAuthenticated && isPublisher) loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isPublisher]);

  // A notification can link here with ?highlight=<report_id> - once
  // the queue has loaded, scroll to and outline the matching card.
  useEffect(() => {
    if (!highlightId || pending === null) return;
    const el = document.getElementById(`peer-review-report-${highlightId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, pending]);

  function handleDecided() {
    // A decision may have moved the report out of "pending" (published
    // or rejected) - simplest correct thing is to just re-fetch rather
    // than try to patch state in place.
    loadPending();
  }

  if (authLoading) return null;

  if (!isAuthenticated || !isPublisher) {
    return (
      <div className="peer-review-page">
        <SEO path="/peer-review" title="Peer Review" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
<<<<<<< HEAD
        <div className="peer-review-gate">
          <h1>Log in to review reports</h1>
          <p>You need an account with publisher access to review reports awaiting approval.</p>
          <Link className="btn btn-primary" to="/login" state={{ from: { pathname: '/peer-review' } }}>
            Log in
          </Link>
        </div>
      </div>
    );
  }

  if (!isPublisher) {
    return (
      <div className="peer-review-page">
        <SEO path="/peer-review" title="Peer Review" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="peer-review-gate">
          <h1>You don't have access to this page</h1>
          <p>
            Reviewing reports is limited to accounts with publisher access. Your current account doesn't have
            that access level yet.
          </p>
          <p>
            To request an upgrade, contact{' '}
            <a href="mailto:support@ittiglobal.org">support@ittiglobal.org</a>.
          </p>
        </div>
=======
        <PublisherAccessGate isAuthenticated={isAuthenticated} fromPath="/peer-review" />
>>>>>>> 8f671229e15aada48f5687f4d21265f7ee9304b1
      </div>
    );
  }

  return (
    <div className="peer-review-page">
      <SEO path="/peer-review" title="Peer Review" noindex />
      <Reveal delay={0}>
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="peer-review-header">
          <div>
            <h2 className="display">Peer Review</h2>
            <p>
              Reports need 3 publisher approvals to publish, or 2 disapprovals to be removed (an admin's decision
              is decisive on its own, either way). You can't review your own submissions.
            </p>
          </div>
        </div>
      </Reveal>

      <nav className="peer-review-nav" aria-label="Peer review sections">
        <span className="peer-review-nav-tab is-active">Awaiting Review</span>
        <Link className="peer-review-nav-tab" to="/peer-review/mine">
          My Submissions
        </Link>
      </nav>

      {error && <p className="peer-review-error">{error}</p>}

      <Reveal delay={30}>
        <section className="peer-review-section">
          {pending === null && !error && <p className="peer-review-status">Loading…</p>}
          {pending !== null && pending.length === 0 && (
            <p className="peer-review-status">Nothing is awaiting review right now.</p>
          )}
          {pending !== null && pending.length > 0 && (
            <div className="peer-review-list">
              {pending.map((report) => (
                <div
                  key={report.id}
                  id={`peer-review-report-${report.id}`}
                  className={`peer-review-item${String(report.id) === highlightId ? ' peer-review-item-highlight' : ''}`}
                >
                  <ReportCard report={report} onRead={(r) => navigate(`/reports/${r.id}`)} />
                  <PeerReviewPanel report={report} currentUser={user} onDecided={handleDecided} />
                </div>
              ))}
            </div>
          )}
        </section>
      </Reveal>
    </div>
  );
}