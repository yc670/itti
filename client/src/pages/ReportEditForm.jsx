import React, { useEffect, useState } from 'react';
import {
  checkReportTitle, checkReportDescription, checkReportCategory, checkReportCombinedSize,
  MAX_REPORT_DESCRIPTION_LENGTH, MAX_REPORT_COMBINED_BYTES,
} from '../utils/formValidation.js';
import { REPORT_CATEGORIES } from '../constants/reportCategories.js';
import ReportPreviewCard from '../components/ReportPreviewCard.jsx';
import { csrfFetch } from '../api.js';

function formatFileSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Shown on the Edit Report page (/reports/:id/edit) - reachable from
 * an "Edit" option on a pending_review report, either in Profile >
 * Publications or directly from My Submissions. Pre-fills every field
 * from the report being edited, same shape as ReportUploadForm but
 * for an existing report rather than a new one.
 *
 * Unlike ResubmitReportForm.jsx (the changes_requested flow), a new
 * file/image are both OPTIONAL here - leaving either blank keeps
 * what's already saved, since this is meant to let a publisher fix a
 * typo or swap one field without being forced to reattach an
 * unchanged file every time. Category is also editable here (it isn't
 * in ResubmitReportForm, since a reviewer never sends a report back
 * for a category change) - see POST /api/reports/<id>/edit in
 * server/app.py for how title/description/category/file/image are
 * applied together.
 *
 * Submitting always bumps the report's version and resets
 * review_status to pending_review - since approvals/rejections are
 * scoped to version (see report_review.py), this clears whatever
 * approve/reject votes had already been cast, same as any other
 * resubmission. Nothing is sent to the server until "Confirm &
 * Reupload" is clicked - Cancel just discards the local form state,
 * so the report already in the peer review queue is untouched either
 * way until then.
 */
export default function ReportEditForm({ report, onSaved, onCancel }) {
  const [title, setTitle] = useState(report.title);
  const [description, setDescription] = useState(report.description);
  const [category, setCategory] = useState(report.category);
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Combined-size check here only bounds whatever is newly selected -
  // the server is the source of truth for the real combined check
  // (existing file/image sizes included), see
  // _save_report_edit_uploads in server/app.py.
  const combinedBytes = (file?.size || 0) + (image?.size || 0);

  // Mirrors ReportUploadForm's blob-URL cleanup, but falls back to the
  // report's already-saved cover image (if any) when no new one has
  // been chosen yet, so the preview always shows what will actually
  // be submitted - the new image if one's picked, the existing one
  // otherwise, or nothing if the report never had one and none is
  // being added now.
  useEffect(() => {
    if (!image) {
      setImagePreviewUrl(report.has_image ? `/api/reports/${report.id}/image` : null);
      return undefined;
    }
    const url = URL.createObjectURL(image);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  function validate() {
    const errors = {};
    const titleError = checkReportTitle(title);
    if (titleError) errors.title = titleError;
    const descriptionError = checkReportDescription(description);
    if (descriptionError) errors.description = descriptionError;
    const categoryError = checkReportCategory(category);
    if (categoryError) errors.category = categoryError;
    const combinedSizeError = checkReportCombinedSize(file, image);
    if (combinedSizeError) errors.combinedSize = combinedSizeError;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus(null);
    if (!validate()) return;

    setSubmitting(true);
    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('description', description.trim());
    formData.append('category', category);
    if (file) formData.append('file', file);
    if (image) formData.append('image', image);

    try {
      const res = await csrfFetch(`/api/reports/${report.id}/edit`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.description || data.error || 'Could not save changes.');
      }
      onSaved(data);
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="report-upload-form">
      <label className="report-upload-field">
        <span>Title</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title" />
        {fieldErrors.title && <span className="report-upload-field-error">{fieldErrors.title}</span>}
      </label>

      <label className="report-upload-field">
        <span className="report-upload-field-label-row">
          <span>Description</span>
          <span
            className={
              'report-upload-char-count' +
              (description.length >= MAX_REPORT_DESCRIPTION_LENGTH ? ' report-upload-char-count--limit' : '')
            }
          >
            {description.length}/{MAX_REPORT_DESCRIPTION_LENGTH}
          </span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_REPORT_DESCRIPTION_LENGTH))}
          placeholder="A short summary of this report"
          rows={4}
          maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
        />
        {fieldErrors.description && (
          <span className="report-upload-field-error">{fieldErrors.description}</span>
        )}
      </label>

      <label className="report-upload-field">
        <span>Section</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {fieldErrors.category && <span className="report-upload-field-error">{fieldErrors.category}</span>}
      </label>

      <label className="report-upload-field">
        <span>Report file (PDF or Word document)</span>
        <div className="report-upload-current-file">
          Current file: <strong>{report.original_filename}</strong> ({report.file_type.toUpperCase()}
          {report.file_size_bytes ? `, ${formatFileSize(report.file_size_bytes)}` : ''})
        </div>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} />
        <span className="report-upload-field-hint">
          Leave blank to keep the current file. Report file and cover image together must be under{' '}
          <strong>2.5 MB</strong> combined.
        </span>
        {fieldErrors.file && <span className="report-upload-field-error">{fieldErrors.file}</span>}
      </label>

      <label className="report-upload-field">
        <span>Cover image (optional)</span>
        {report.has_image ? (
          <img className="report-upload-current-image" src={`/api/reports/${report.id}/image`} alt="Current cover" />
        ) : (
          <p className="report-upload-current-image-empty">No cover image currently set.</p>
        )}
        <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setImage(e.target.files[0] || null)} />
        <span className="report-upload-field-hint">
          Leave blank to keep the current cover image (or lack of one). Displays in a wide, short frame on the
          reports list, so landscape images work best - a <strong>1200×630px</strong> image (or anything close to
          that ~2:1 width-to-height ratio) will fill the space with no empty bars.
        </span>
      </label>

      {(file || image) && (
        <p
          className={
            'report-upload-size-total' +
            (combinedBytes > MAX_REPORT_COMBINED_BYTES ? ' report-upload-size-total--over' : '')
          }
        >
          New file + cover image: <strong>{(combinedBytes / (1024 * 1024)).toFixed(2)} MB</strong> of a{' '}
          <strong>{(MAX_REPORT_COMBINED_BYTES / (1024 * 1024)).toFixed(1)} MB</strong> combined limit
        </p>
      )}
      {fieldErrors.combinedSize && (
        <span className="report-upload-field-error">{fieldErrors.combinedSize}</span>
      )}

      {status && <p className={`report-upload-status report-upload-status--${status.type}`}>{status.message}</p>}

      <div className="report-upload-preview-section">
        <h3 className="report-upload-preview-title">Preview: how this will look once approved</h3>
        <p className="report-upload-preview-hint">
          This reflects your edits, including any unsaved changes above - it's how the report panel will appear
          once this new version clears peer review.
        </p>
        <ReportPreviewCard
          title={title}
          description={description}
          authorName={report.author}
          categoryLabel={category}
          imageUrl={imagePreviewUrl}
        />
      </div>

      <div className="report-upload-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Reuploading…' : 'Confirm & Reupload to Peer Review'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
