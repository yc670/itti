import { useState } from 'react';
import Modal from './Modal.jsx';

/**
 * Shared by every page that lets a publisher delete their own report
 * (Reports.jsx, PeerReviewMine.jsx, ReportView.jsx) - deliberately one
 * component rather than three copies, since the branching logic
 * (published vs. not) and the reason requirement need to stay
 * identical everywhere a report can be deleted.
 *
 * report.review_status decides which action actually happens on
 * confirm:
 *   - "published"            -> requires a typed reason, calls
 *                                onRequestDeletion(reason) - starts the
 *                                reviewer-approval watching period (see
 *                                docs/ACCESS_LEVELS.md's "Report
 *                                deletion" section) rather than
 *                                deleting outright.
 *   - anything else           -> no reason needed (this report was
 *                                never public - pending_review/
 *                                changes_requested/rejected), calls
 *                                onInstantDelete() - the ordinary
 *                                immediate soft-delete.
 * An admin deleting ANY report (published or not) always gets the
 * instant path - see canInstantDelete below, passed in by the caller
 * since only it knows the current user's role.
 */
export default function DeleteReportModal({ report, canInstantDelete, onInstantDelete, onRequestDeletion, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const needsReason = report.review_status === 'published' && !canInstantDelete;

  async function handleConfirm() {
    setError(null);

    if (needsReason && !reason.trim()) {
      setError('A reason is required to request deletion.');
      return;
    }

    setSubmitting(true);
    try {
      if (needsReason) {
        await onRequestDeletion(reason.trim());
      } else {
        await onInstantDelete();
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={needsReason ? 'Request deletion' : 'Delete report'}
      onClose={submitting ? undefined : onClose}
      footer={
        <>
          <button type="button" className="app-modal-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="app-modal-btn app-modal-btn--primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Submitting…' : needsReason ? 'Submit request' : 'Delete'}
          </button>
        </>
      }
    >
      {needsReason ? (
        <>
          <p>
            <strong>{report.title}</strong> is already published. Deleting it needs a reviewer's approval - it
            stays visible on the public Reports page until then. Please explain why you want it removed:
          </p>
          <textarea
            className="delete-report-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this report be deleted?"
            rows={4}
            autoFocus
          />
        </>
      ) : (
        <p>
          Delete <strong>{report.title}</strong>? This removes it from view - it can be restored later if needed.
        </p>
      )}
      {error && <p className="app-modal-error">{error}</p>}
    </Modal>
  );
}