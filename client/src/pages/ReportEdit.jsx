import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportEditForm from './ReportEditForm.jsx';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/ReportPublish.css';

/**
 * Standalone "edit a report" page at /reports/:id/edit - reachable
 * from an Edit option on a pending_review report, either in Profile >
 * Publications or directly from My Submissions (see PeerReviewMine.jsx
 * and ReportCard.jsx's onEdit prop). Mirrors ReportPublish.jsx's
 * structure/gates closely, since it's the same kind of standalone
 * form page, just for an existing report instead of a new one.
 *
 * Loads the report itself via GET /api/reports/:id rather than
 * requiring the caller to pass it in via route state, so a direct URL
 * visit or a page refresh while editing still works. That route's own
 * visibility rule (_can_view_report in server/app.py) already allows
 * the uploader to see their own report regardless of review_status,
 * so no separate permission check is needed here beyond confirming
 * the loaded report's uploaded_by matches the logged-in user and its
 * review_status is still pending_review - both enforced again
 * server-side by POST /api/reports/<id>/edit regardless of what this
 * page does.
 */
export default function ReportEdit() {
  const { id } = useParams();
  const { user, isAuthenticated, isPublisher, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`/api/reports/${id}`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setReport)
      .catch(() => setLoadError('This report could not be found, or you don\u2019t have access to edit it.'));
  }, [id, isAuthenticated]);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="report-publish-page">
        <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
        <Link to="/peer-review/mine" className="page-back-link">
          ← Back to My Submissions
        </Link>
        <div className="report-publish-gate">
          <h1>Log in to edit this report</h1>
          <p>You need an account to edit a report awaiting peer review.</p>
          <Link className="btn btn-primary" to="/login" state={{ from: { pathname: `/reports/${id}/edit` } }}>
            Log in
          </Link>
        </div>
      </div>
    );
  }

  if (!isPublisher) {
    return (
      <div className="report-publish-page">
        <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
        <Link to="/peer-review/mine" className="page-back-link">
          ← Back to My Submissions
        </Link>
        <div className="report-publish-gate">
          <h1>You don't have access to this page</h1>
          <p>
            Editing a report is limited to accounts with publisher access. Your current account doesn't have that
            access level yet.
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="report-publish-page">
        <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
        <Link to="/peer-review/mine" className="page-back-link">
          ← Back to My Submissions
        </Link>
        <div className="report-publish-gate">
          <h1>Can't edit this report</h1>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  if (report && report.uploaded_by !== user.id) {
    return (
      <div className="report-publish-page">
        <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
        <Link to="/peer-review/mine" className="page-back-link">
          ← Back to My Submissions
        </Link>
        <div className="report-publish-gate">
          <h1>You can only edit your own reports</h1>
          <p>This report was uploaded by someone else.</p>
        </div>
      </div>
    );
  }

  if (report && report.review_status !== 'pending_review') {
    return (
      <div className="report-publish-page">
        <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
        <Link to="/peer-review/mine" className="page-back-link">
          ← Back to My Submissions
        </Link>
        <div className="report-publish-gate">
          <h1>This report can't be edited right now</h1>
          <p>
            {report.review_status === 'changes_requested'
              ? 'This report is awaiting a resubmission - use the Resubmit option in My Submissions instead.'
              : 'Editing is only available while a report is awaiting review, before any reviewer has decided on it.'}
          </p>
          <Link className="btn btn-secondary" to="/peer-review/mine">
            Back to My Submissions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="report-publish-page">
      <SEO path={`/reports/${id}/edit`} title="Edit Report" noindex />
      <Link to="/peer-review/mine" className="page-back-link">
        ← Back to My Submissions
      </Link>
      <Reveal delay={0}>
        <div>
          <h1 className="display">Edit Report</h1>
          <p>
            Update this report while it's still awaiting review. Confirming sends it back through peer review from
            the start - any approvals or disapprovals already cast are cleared for the new version.
          </p>
        </div>
      </Reveal>

      {saved ? (
        <Reveal delay={30}>
          <div className="report-publish-success">
            <h2>Changes submitted</h2>
            <p>“{saved.title}” has been reuploaded to peer review.</p>
            <div className="report-publish-success-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate('/peer-review/mine')}>
                Back to My Submissions
              </button>
            </div>
          </div>
        </Reveal>
      ) : report === null ? (
        <p className="peer-review-status">Loading…</p>
      ) : (
        <Reveal delay={30}>
          {/* Same real-DOM-element wrapper as ReportPublish.jsx - see
              that file's comment for why ReportEditForm can't be
              wrapped in <Reveal> directly. */}
          <div>
            <ReportEditForm report={report} onSaved={setSaved} onCancel={() => navigate('/peer-review/mine')} />
          </div>
        </Reveal>
      )}
    </div>
  );
}
