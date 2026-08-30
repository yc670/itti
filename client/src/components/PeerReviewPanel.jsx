import React, { useEffect, useState } from 'react';
import { csrfFetch } from '../api.js';

// Must stay in sync with REQUIRED_APPROVALS/REQUIRED_REJECTIONS in
// server/models/report.py - the server is the source of truth for
// what actually publishes or removes a report, these are only for the
// progress text ("1 of 3 approvals", "1 of 2 disapprovals").
const REQUIRED_APPROVALS = 3;
const REQUIRED_REJECTIONS = 2;

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * One report's review controls + existing comments, shown under its
 * ReportCard on both peer review pages (the shared "Awaiting Review"
 * queue and a user's own "My Submissions" list). Fetches its own
 * reviews independently (rather than the parent page fetching all of
 * them up front) since there's no bulk endpoint for "reviews across
 * many reports" and most of these lists are short.
 *
 * A report's uploader always sees this in read-only form (no vote
 * controls) - on the shared queue because self-review isn't allowed,
 * and on their own "My Submissions" list because every report shown
 * there is, by definition, their own.
 */
export default function PeerReviewPanel({ report, currentUser, onDecided }) {
  const [reviews, setReviews] = useState(null); // null = loading
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(null); // 'approve' | 'reject' | null
  const [error, setError] = useState(null);

  const isOwnReport = report.uploaded_by === currentUser.id;
  const isAdmin = currentUser.role === 'admin';
  const isTerminal = report.review_status === 'published' || report.review_status === 'rejected';

  function loadReviews() {
    fetch(`/api/reports/${report.id}/reviews`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setReviews)
      .catch(() => setReviews([]));
  }

  useEffect(() => {
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, report.version]);

  const currentVersionReviews = (reviews || []).filter((r) => r.version === report.version);
  const approvals = currentVersionReviews.filter((r) => r.decision === 'approve');
  const rejections = currentVersionReviews.filter((r) => r.decision === 'reject');
  const myDecision = currentVersionReviews.find((r) => r.reviewer_id === currentUser.id)?.decision;

  async function submitDecision(decision) {
    if (decision === 'reject' && !comment.trim()) {
      setError('A comment is required when disapproving.');
      return;
    }
    setSubmitting(decision);
    setError(null);
    try {
      const res = await csrfFetch(`/api/reports/${report.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.description || data.error || 'Could not submit review.');
      setComment('');
      loadReviews();
      onDecided(report.id, data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="peer-review-panel">
      {report.review_status === 'published' ? (
        <p className="peer-review-own-note peer-review-own-note--published">Published — visible on the public Reports page.</p>
      ) : report.review_status === 'rejected' ? (
        <p className="peer-review-own-note peer-review-own-note--rejected">
          Not approved by peer review and removed from the queue.
        </p>
      ) : isOwnReport ? (
        <p className="peer-review-own-note">This is your submission — you can't review your own report.</p>
      ) : myDecision ? (
        <p className="peer-review-own-note">
          You already {myDecision === 'approve' ? 'approved' : 'disapproved'} this version.
        </p>
      ) : (
        <div className="peer-review-form">
          {isAdmin && (
            <p className="peer-review-admin-note">
              As an admin, approving publishes this immediately and disapproving removes it immediately — neither
              needs a second vote.
            </p>
          )}
          <textarea
            className="peer-review-comment-input"
            placeholder="Comment (required to disapprove, optional to approve)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
          {error && <p className="peer-review-error">{error}</p>}
          <div className="peer-review-actions">
            <button
              type="button"
              className="peer-review-approve-btn"
              disabled={submitting !== null}
              onClick={() => submitDecision('approve')}
            >
              {submitting === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              className="peer-review-reject-btn"
              disabled={submitting !== null}
              onClick={() => submitDecision('reject')}
            >
              {submitting === 'reject' ? 'Disapproving…' : 'Disapprove'}
            </button>
          </div>
        </div>
      )}

      {!isTerminal && (
        <p className="peer-review-progress">
          {approvals.length} of {REQUIRED_APPROVALS} approvals
          {approvals.length > 0 && ` (${approvals.map((a) => a.reviewer_name).join(', ')})`}
          {' · '}
          {rejections.length} of {REQUIRED_REJECTIONS} disapprovals
        </p>
      )}

      {reviews === null ? (
        <p className="peer-review-status">Loading comments…</p>
      ) : currentVersionReviews.length > 0 ? (
        <ul className="peer-review-comments">
          {currentVersionReviews.map((r) => (
            <li key={r.id} className={`peer-review-comment peer-review-comment--${r.decision}`}>
              <span className="peer-review-comment-head">
                {r.reviewer_name} · {r.decision === 'approve' ? 'Approved' : 'Disapproved'} · {formatDate(r.created_at)}
              </span>
              {r.comment && <p className="peer-review-comment-body">{r.comment}</p>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}