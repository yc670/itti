import React, { useState } from 'react';
import { checkReportTitle, checkReportDescription } from '../utils/formValidation.js';
import { csrfFetch } from '../api.js';

/**
 * Shown inline under a report in Profile > Publications once it's
 * review_status === "changes_requested" - the uploader's own only way
 * to act on reviewer feedback. Reuses the same field styling as
 * ReportUploadForm (report-upload-*) since it's the same kind of form,
 * just pre-filled and with one extra field.
 *
 * Title/description are pre-filled from the current report and
 * optional to change - the server (resubmit_report in
 * models/report.py) only updates whatever's actually sent, leaving
 * the rest as-is. resubmission_note is the uploader's own message
 * back to reviewers (e.g. "Added the citations you asked for") -
 * shown alongside their review comment history, not required. A file
 * is always required, even if unchanged, since POST
 * /api/reports/<id>/resubmit always bumps the version and a version
 * with no new file wouldn't make sense.
 */
export default function ResubmitReportForm({ report, onResubmitted, onCancel }) {
  const [title, setTitle] = useState(report.title);
  const [description, setDescription] = useState(report.description);
  const [resubmissionNote, setResubmissionNote] = useState('');
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    const errors = {};
    const titleError = checkReportTitle(title);
    if (titleError) errors.title = titleError;
    const descriptionError = checkReportDescription(description);
    if (descriptionError) errors.description = descriptionError;
    if (!file) errors.file = 'A PDF or Word document is required, even if unchanged from before.';
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
    if (resubmissionNote.trim()) formData.append('resubmission_note', resubmissionNote.trim());
    formData.append('file', file);
    if (image) formData.append('image', image);

    try {
      const res = await csrfFetch(`/api/reports/${report.id}/resubmit`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.description || data.error || 'Resubmission failed.');
      }
      onResubmitted(data);
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
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        {fieldErrors.title && <span className="report-upload-field-error">{fieldErrors.title}</span>}
      </label>

      <label className="report-upload-field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        {fieldErrors.description && (
          <span className="report-upload-field-error">{fieldErrors.description}</span>
        )}
      </label>

      <label className="report-upload-field">
        <span>Note to reviewers (optional)</span>
        <textarea
          value={resubmissionNote}
          onChange={(e) => setResubmissionNote(e.target.value)}
          placeholder="What changed since the last version?"
          rows={2}
        />
      </label>

      <label className="report-upload-field">
        <span>Updated report file (PDF or Word document)</span>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} />
        {fieldErrors.file && <span className="report-upload-field-error">{fieldErrors.file}</span>}
      </label>

      <label className="report-upload-field">
        <span>Cover image (optional — leave blank to keep the current one)</span>
        <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setImage(e.target.files[0] || null)} />
      </label>

      {status && <p className={`report-upload-status report-upload-status--${status.type}`}>{status.message}</p>}

      <div className="report-upload-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Resubmitting…' : 'Resubmit for review'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}