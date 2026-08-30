import React, { useEffect, useState } from 'react';
import {
  checkReportTitle, checkReportDescription, checkReportCategory, checkReportCombinedSize,
  MAX_REPORT_DESCRIPTION_LENGTH, MAX_REPORT_COMBINED_BYTES,
} from '../utils/formValidation.js';
import { REPORT_CATEGORIES, DEFAULT_REPORT_CATEGORY } from '../constants/reportCategories.js';
import { useAuth } from '../context/AuthContext.jsx';
import ReportPreviewCard from '../components/ReportPreviewCard.jsx';
import { csrfFetch } from '../api.js';

/**
 * Publisher/admin-only upload form for the Reports page. The actual
 * enforcement is server-side (@roles_required("publisher", "admin") on
 * POST /api/reports) - this component is only ever rendered after
 * Reports.jsx has already checked the user's role, but doesn't re-check
 * here itself, since its parent is the single source of truth for
 * whether to show it at all.
 */
export default function ReportUploadForm({ onUploaded, onCancel }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(DEFAULT_REPORT_CATEGORY);
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const combinedBytes = (file?.size || 0) + (image?.size || 0);

  // Object URLs need explicit cleanup - revoke the previous one
  // whenever `image` changes (including to null, on unmount) so
  // swapping the cover image a few times while filling out the form
  // doesn't leak blob URLs. This is what makes the preview's thumbnail
  // update live the instant a new cover image is chosen.
  useEffect(() => {
    if (!image) {
      setImagePreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(image);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function validate() {
    const errors = {};
    const titleError = checkReportTitle(title);
    if (titleError) errors.title = titleError;
    const descriptionError = checkReportDescription(description);
    if (descriptionError) errors.description = descriptionError;
    const categoryError = checkReportCategory(category);
    if (categoryError) errors.category = categoryError;
    if (!file) errors.file = 'A PDF or Word document is required.';
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
    formData.append('file', file);
    if (image) formData.append('image', image);

    try {
      const res = await csrfFetch('/api/reports', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.description || data.error || 'Upload failed.');
      }
      onUploaded(data);
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
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Report title"
        />
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
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} />
        <span className="report-upload-field-hint">
          Report file and cover image together must be under <strong>2.5 MB</strong> combined.
        </span>
        {fieldErrors.file && <span className="report-upload-field-error">{fieldErrors.file}</span>}
      </label>

      <label className="report-upload-field">
        <span>Cover image (optional)</span>
        <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setImage(e.target.files[0] || null)} />
        <span className="report-upload-field-hint">
          Displays in a wide, short frame on the reports list, so landscape images work best - a
          <strong> 1200×630px</strong> image (or anything close to that ~2:1 width-to-height ratio) will fill the
          space with no empty bars. Portrait or square images still display in full, just with some empty space on
          the sides.
        </span>
      </label>

      <p
        className={
          'report-upload-size-total' +
          (combinedBytes > MAX_REPORT_COMBINED_BYTES ? ' report-upload-size-total--over' : '')
        }
      >
        Report file + cover image: <strong>{(combinedBytes / (1024 * 1024)).toFixed(2)} MB</strong> of a{' '}
        <strong>{(MAX_REPORT_COMBINED_BYTES / (1024 * 1024)).toFixed(1)} MB</strong> combined limit
      </p>
      {fieldErrors.combinedSize && (
        <span className="report-upload-field-error">{fieldErrors.combinedSize}</span>
      )}

      {status && <p className={`report-upload-status report-upload-status--${status.type}`}>{status.message}</p>}

      <div className="report-upload-preview-section">
        <h3 className="report-upload-preview-title">Preview: how this will look once approved</h3>
        <p className="report-upload-preview-hint">
          This is a live preview of the report panel that will appear once this report clears peer review.
        </p>
        <ReportPreviewCard
          title={title}
          description={description}
          authorName={user?.name}
          categoryLabel={category}
          imageUrl={imagePreviewUrl}
        />
      </div>

      <div className="report-upload-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Uploading…' : 'Upload report'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}