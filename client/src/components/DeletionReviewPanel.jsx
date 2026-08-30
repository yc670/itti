import { useState } from 'react';
import { reviewDeletionRequest } from '../api.js';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Shown under a ReportCard on the Peer Review page's Deletion Requests
 * tab (reviewer/admin only). Unlike PeerReviewPanel (the publish
 * workflow's vote-counted approve/reject), a deletion request is
 * decided by a SINGLE reviewer/admin, final immediately either way -
 * see record_deletion_review() in server/models/report_review.py for
 * the full reasoning. There's no "N of M approvals" progress here,
 * because there's no vote count to show.
 *
 * currentUser is passed the same way PeerReviewPanel receives it, for
 * the same reason: self-review isn't allowed (a publisher can't decide
 * their own deletion request), enforced server-side but checked here
 * too so the buttons simply don't render rather than round-tripping to
 * a 400.
 */
export default function DeletionReviewPanel({ report, currentUser, onDecided }) {
  const [submitting, setSubmitting] = useState(null); // 'approve' | 'deny' | null
  const [error, setError] = useState(null);

  const isOwnReport = report.uploaded_by === currentUser.id;

  async function submitDecision(decision) {
    setSubmitting(decision);
    setError(null);
    try {
      const updated = await reviewDeletionRequest(report.id, decision);
      onDecided(report.id, updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="peer-review-panel">
      <p className="deletion-request-reason">
        <strong>Reason given:</strong> {report.pending_deletion_reason}
      </p>
      <p className="peer-review-status">
        Requested {formatDate(report.pending_deletion_requested_at)}
      </p>

      {isOwnReport ? (
        <p className="peer-review-own-note">This is your own submission - you can't decide its deletion request.</p>
      ) : (
        <>
          {error && <p className="peer-review-error">{error}</p>}
          <div className="peer-review-actions">
            <button
              type="button"
              className="peer-review-reject-btn"
              disabled={submitting !== null}
              onClick={() => submitDecision('approve')}
            >
              {submitting === 'approve' ? 'Approving…' : 'Approve deletion'}
            </button>
            <button
              type="button"
              className="peer-review-approve-btn"
              disabled={submitting !== null}
              onClick={() => submitDecision('deny')}
            >
              {submitting === 'deny' ? 'Denying…' : 'Deny (keep published)'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}