import React from 'react';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * canManage: true if the current user is either this report's uploader
 * or an admin - passed down from Reports.jsx, which already has the
 * logged-in user's id/role, rather than this component re-deriving it.
 *
 * isFavorited/onToggleFavorite: both optional. Omit them (e.g. when
 * rendering a logged-out visitor's card) and the star doesn't render at
 * all, rather than rendering a star that can't do anything.
 *
 * onDelete: called with the FULL report object (not just its id) - the
 * caller needs review_status to decide whether this is an instant
 * delete or a request-deletion-with-reason (see DeleteReportModal.jsx).
 *
 * onRead: navigates to this report's own page (/reports/:id, see
 * ReportView.jsx). Always shown - unlike the star, reading a report
 * needs no login.
 *
 * Dates: created_at and updated_at are both always shown (per the
 * report-panel spec), but updated_at is the visually prominent one -
 * it's the more useful signal ("is this still current"), while
 * created_at is secondary context. When a report has never been
 * revised since publication the two timestamps are identical; both
 * still render rather than being collapsed into one, so the layout
 * (and what a scanning reader can rely on being there) never shifts
 * between reports.
 */
export default function ReportCard({ report, canManage, onDelete, onEdit, isFavorited, onToggleFavorite, onRead }) {
  return (
    <div className="report-card">
      {report.has_image && (
        <img
          className="report-card-image"
          src={`/api/reports/${report.id}/image`}
          alt=""
          loading="lazy"
        />
      )}
      <div className="report-card-body">
        <div className="report-card-heading">
          <h3 className="report-card-title">{report.title}</h3>
          {onToggleFavorite && (
            <button
              type="button"
              className={`report-card-favorite${isFavorited ? ' is-favorited' : ''}`}
              onClick={() => onToggleFavorite(report.id, isFavorited)}
              aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorited ? '★' : '☆'}
            </button>
          )}
        </div>

        <p className="report-card-author">By {report.author}</p>

        <p className="report-card-description">{report.description}</p>

        <div className="report-card-dates">
          <span className="report-card-date-updated">Updated {formatDate(report.updated_at)}</span>
          <span className="report-card-date-created">Published {formatDate(report.created_at)}</span>
        </div>

        <div className="report-card-meta">
          <span className="report-card-filetype">{report.file_type.toUpperCase()}</span>
          {report.file_size_bytes && <span>{formatFileSize(report.file_size_bytes)}</span>}
        </div>

        <div className="report-card-actions">
          <div className="report-card-actions-left">
            <button type="button" className="report-card-read" onClick={() => onRead(report)}>
              Read
            </button>
            <a
              className="report-card-download"
              href={`/api/reports/${report.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </a>
          </div>
          {canManage && (
            <button
              type="button"
              className="report-card-delete"
              onClick={() => onDelete(report)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}