import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import { csrfFetch } from '../api.js';
import '../styles/PublishGlobeData.css';

const KIND_OPTIONS = [
  { value: 'GTBI', label: 'GTBI', description: 'Global Trauma Burden Index workbook' },
  { value: 'ETTI', label: 'ETTI', description: 'Election Trauma Temperature Index workbook' },
];

/**
 * Reachable by anyone (not wrapped in <ProtectedRoute>) so that a
 * non-publisher landing here - whether by following the nav link or a
 * direct URL - sees an explanation of why they can't use this page,
 * rather than being silently redirected elsewhere. The actual upload
 * is still enforced server-side by @roles_required("publisher") on
 * POST /api/globe-data/upload regardless of what this component does.
 */
export default function PublishGlobeData() {
  const { isAuthenticated, isPublisher, loading: authLoading } = useAuth();

  const [kind, setKind] = useState(null); // "GTBI" | "ETTI" | null
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message }
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) return null;

  if (!isAuthenticated || !isPublisher) {
    return (
      <div className="globe-upload-page">
      <SEO
        path="/publish/globe-data"
        title="Update Globe Data"
        noindex
      />
        <div className="globe-upload-denied">
          <h1>You don't have access to this page</h1>
          <p>
            Uploading GTBI or ETTI data is limited to accounts with publisher access.
            {!isAuthenticated
              ? ' Log in with a publisher account to continue.'
              : ' Your current account does not have publisher access.'}
          </p>
        </div>
      </div>
    );
  }

  function handleKindSelect(selected) {
    setKind(selected);
    setFile(null);
    setStatus(null);
  }

  function handleFileChange(e) {
    setFile(e.target.files[0] || null);
    setStatus(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!kind || !file) return;

    setSubmitting(true);
    setStatus(null);

    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file);

    try {
      const res = await csrfFetch('/api/globe-data/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.description || data.error || 'Upload failed');
      }

      setStatus({
        type: 'success',
        message: `${kind} data updated for ${data.countries_updated.length} countries. The globe will reflect these changes.`,
      });
      setFile(null);
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="globe-upload-page">
      <SEO
        path="/publish/globe-data"
        title="Update Globe Data"
        noindex
      />
      <h2 className="display">Update Globe Data</h2>
      <p>Upload a GTBI or ETTI workbook to update the figures shown on the globe.</p>

      <Reveal delay={0}>
        <div className="globe-upload-kind-choice">
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`globe-upload-kind-btn${kind === opt.value ? ' active' : ''}`}
              onClick={() => handleKindSelect(opt.value)}
            >
              <span className="globe-upload-kind-label">{opt.label}</span>
              <span className="globe-upload-kind-desc">{opt.description}</span>
            </button>
          ))}
        </div>
      </Reveal>

      {kind && (
        <Reveal delay={0}>
          <form onSubmit={handleSubmit} className="globe-upload-form">
            <label className="globe-upload-file-label">
              <span>{kind} spreadsheet (.xlsx)</span>
              <input type="file" accept=".xlsx" onChange={handleFileChange} required />
            </label>
            <button className="auth-submit" type="submit" disabled={!file || submitting} style={{ width: 'auto' }}>
              {submitting ? 'Processing…' : `Upload ${kind} data`}
            </button>
          </form>
        </Reveal>
      )}

      {status && (
        <p className={`globe-upload-status globe-upload-status--${status.type}`}>{status.message}</p>
      )}
    </div>
  );
}