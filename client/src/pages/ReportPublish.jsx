import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportUploadForm from './ReportUploadForm.jsx';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/ReportPublish.css';

/**
 * Standalone "create/upload a report" page, linked from the Publish a
 * Report section on /reports. Reachable by anyone (not wrapped in
 * <ProtectedRoute>) so a signed-out visitor or a signed-in
 * non-publisher landing here - whether via that link or a direct URL -
 * sees an explanation of why they can't use this page, rather than
 * being silently redirected elsewhere. Mirrors the pattern used by
 * PublishGlobeData.jsx. The actual upload is still enforced
 * server-side by @roles_required("publisher", "admin") on
 * POST /api/reports regardless of what this component does.
 */
export default function ReportPublish() {
  const { isAuthenticated, isPublisher, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [uploaded, setUploaded] = useState(null);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="report-publish-page">
        <SEO path="/reports/publish" title="Publish a Report" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="report-publish-gate">
          <h1>Log in to publish a report</h1>
          <p>You need an account to upload a report for peer review.</p>
          <Link className="btn btn-primary" to="/login" state={{ from: { pathname: '/reports/publish' } }}>
            Log in
          </Link>
        </div>
      </div>
    );
  }

  if (!isPublisher) {
    return (
      <div className="report-publish-page">
        <SEO path="/reports/publish" title="Publish a Report" noindex />
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div className="report-publish-gate">
          <h1>You don't have access to this page</h1>
          <p>
            Publishing a report is limited to accounts with publisher access. Your current account doesn't have
            that access level yet.
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
    <div className="report-publish-page">
      <SEO path="/reports/publish" title="Publish a Report" noindex />
      <Reveal delay={0}>
        <Link to="/reports" className="page-back-link">
          ← Back to Reports
        </Link>
        <div>
          <h1 className="display">Publish a Report</h1>
          <p>
            Upload a report for peer review. Once three other publishers approve it (or an admin approves it
            instantly), it appears on the public Reports page. Two disapprovals remove it from the queue instead.
          </p>
        </div>
      </Reveal>

      {uploaded ? (
        <Reveal delay={30}>
          <div className="report-publish-success">
            <h2>Submitted for review</h2>
            <p>“{uploaded.title}” has been sent to peer review. You can track its status from your profile.</p>
            <div className="report-publish-success-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate('/peer-review/mine')}>
                Track it in My Submissions
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/reports')}>
                Back to Reports
              </button>
            </div>
          </div>
        </Reveal>
      ) : (
        <Reveal delay={30}>
          <ReportUploadForm onUploaded={setUploaded} onCancel={() => navigate('/reports')} />
        </Reveal>
      )}
    </div>
  );
}