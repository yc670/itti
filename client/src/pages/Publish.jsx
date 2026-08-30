import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import { csrfFetch } from '../api.js';
import '../styles/Publish.css';

/**
 * Only reachable by role === "publisher" (see the
 * <ProtectedRoute requireRole="publisher"> wrapper in App.jsx). Upload
 * hits POST /api/documents, separately guarded server-side by
 * @roles_required("publisher") — the frontend gate is UX, the backend
 * gate is what actually enforces the access level.
 */
export default function Publish() {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState(null);

  async function loadDocuments() {
    const res = await fetch('/api/documents', { credentials: 'include' });
    if (res.ok) setDocuments(await res.json());
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setStatus('uploading…');
    const res = await csrfFetch('/api/documents', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      setStatus('uploaded');
      e.target.reset();
      loadDocuments();
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(`error: ${data.description || data.error}`);
    }
  }

  async function handleDelete(id) {
    const res = await csrfFetch(`/api/documents/${id}`, {
      method: 'DELETE'
    });
    if (res.ok) loadDocuments();
  }

  return (
    <div className="publish-page">
      <SEO
        path="/publish"
        title="Publish"
        noindex
      />
      <h2 className="display">Publish</h2>
      <p>Upload and manage documents. Only publishers can reach this page.</p>

      <Reveal delay={0}>
        <p className="publish-globe-data-link">
          Need to update the GTBI/ETTI figures shown on the globe instead?{' '}
          <Link to="/publish/globe-data">Update Globe Data</Link>
        </p>
      </Reveal>

      <Reveal delay={0}>
        <form onSubmit={handleUpload} className="publish-upload-form">
          <input type="file" name="file" required />
          <button className="auth-submit" type="submit" style={{ width: 'auto' }}>
            Upload
          </button>
        </form>
      </Reveal>
      {status && <p className="publish-status">{status}</p>}

      <Reveal delay={90}>
        <ul className="publish-doc-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <span>{doc.filename}</span>
              <button onClick={() => handleDelete(doc.id)}>Delete</button>
            </li>
          ))}
          {documents.length === 0 && <li className="publish-empty">No documents yet.</li>}
        </ul>
      </Reveal>
    </div>
  );
}