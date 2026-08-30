import React from 'react';

/**
 * A live, read-only preview of how a report will look once approved -
 * shown at the bottom of ReportUploadForm and ReportEditForm, below
 * the actual form fields, so a publisher can see the effect of what
 * they're typing (or which cover image they've picked) before they
 * submit it. Every prop here is fed directly from the form's own
 * state/blob-URL, so the preview re-renders on every keystroke or file
 * selection with no extra wiring needed in this component itself.
 *
 * Deliberately styled after the report PANEL on ReportView.jsx (the
 * standalone /reports/:id reading page - title, "By Author ·
 * Category", Read/Download actions) rather than the list-style
 * ReportCard.jsx used on the Reports page: this is meant to be a
 * compact, at-a-glance panel next to the form, not a full-size card.
 * ReportView itself has no cover image anywhere in its header, but the
 * thumbnail here is still worth including - it's one of the three
 * fields (title/description/cover image) a publisher most wants to
 * confirm before submitting, and a small thumbnail keeps the panel
 * compact rather than turning it back into a full-width card image.
 * Nothing here is interactive - Read/Download are inert placeholders,
 * since this preview never leaves the form it's shown on and there's
 * nothing to read or download yet.
 */
export default function ReportPreviewCard({ title, description, authorName, categoryLabel, imageUrl }) {
  return (
    <div className="report-preview-card-wrap">
      <span className="report-preview-ribbon">Preview</span>
      <div className="report-preview-view-panel">
        <div className="report-preview-view-header">
          {imageUrl && <img className="report-preview-view-thumb" src={imageUrl} alt="" />}
          <div className="report-preview-view-header-text">
            <h3 className="report-preview-view-title">{title || 'Untitled report'}</h3>
            <p className="report-preview-view-author">
              By {authorName || 'You'}
              {categoryLabel ? ` · ${categoryLabel}` : ''}
            </p>
          </div>
          <div className="report-preview-view-actions">
            <button type="button" className="report-preview-view-btn" disabled>
              Read
            </button>
            <span className="report-preview-view-download">Download</span>
          </div>
        </div>
        <p className="report-preview-view-description">
          {description || 'Your description will appear here.'}
        </p>
      </div>
    </div>
  );
}
