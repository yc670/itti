import { useEffect, useState } from 'react';
import { csrfFetch } from '../api.js';
import { FELLOW_LEVELS } from '../data/fellowship.js';

const EMPTY_FORM = { name: '', level: FELLOW_LEVELS[0]?.code || '', bio: '' };

/**
 * The Fellows section of the admin Control panel (see ControlPanel.jsx
 * for the Observatory/Country-profile upload sections next to this
 * one). Two modes sharing one form:
 *   - "add" - blank form, POSTs to /api/fellows
 *   - editing an existing fellow (selected from the roster list below)
 *     - form pre-filled from that fellow, PUTs to /api/fellows/<id>
 *
 * Photo handling: whatever image file is chosen is sent as-is - the
 * server (image_processing.py) is what normalizes it to a consistent
 * size/format before storing it, so this component never needs to
 * resize, crop, or re-encode anything itself. A photo is optional both
 * when adding (falls back to initials on the public page, same as
 * before) and when editing (omit it to leave the current photo
 * unchanged; the explicit "Remove photo" checkbox is the only way to
 * clear one).
 */
export default function FellowsControl() {
  const [fellows, setFellows] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState('add'); // 'add' | fellow id
  const [form, setForm] = useState(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function loadFellows() {
    setError(null);
    return fetch('/api/fellows', { credentials: 'include' })
      .then((res) => res.json())
      .then(setFellows)
      .catch(() => setError('Could not load the current roster.'));
  }

  useEffect(() => {
    loadFellows();
  }, []);

  function selectFellow(idOrAdd) {
    setSelectedId(idOrAdd);
    setPhotoFile(null);
    setRemovePhoto(false);
    setStatus(null);

    if (idOrAdd === 'add') {
      setForm(EMPTY_FORM);
      return;
    }
    const fellow = fellows?.find((f) => f.id === idOrAdd);
    if (fellow) {
      setForm({ name: fellow.name, level: fellow.level, bio: fellow.bio });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const formData = new FormData();
    formData.append('name', form.name);
    formData.append('level', form.level);
    formData.append('bio', form.bio);
    if (photoFile) formData.append('photo', photoFile);
    if (selectedId !== 'add' && removePhoto) formData.append('remove_photo', 'true');

    const isEdit = selectedId !== 'add';
    const url = isEdit ? `/api/fellows/${selectedId}` : '/api/fellows';

    try {
      const res = await csrfFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.description || data.error || 'Save failed');

      setStatus({ type: 'success', message: isEdit ? `${data.name} updated.` : `${data.name} added to the roster.` });
      setPhotoFile(null);
      setRemovePhoto(false);
      await loadFellows();
      if (!isEdit) selectFellow(data.id);
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (selectedId === 'add') return;
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await csrfFetch(`/api/fellows/${selectedId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.description || data.error || 'Delete failed');
      await loadFellows();
      selectFellow('add');
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  const currentFellow = selectedId !== 'add' ? fellows?.find((f) => f.id === selectedId) : null;

  return (
    <section className="control-section">
      <h3>Fellows</h3>
      <p className="control-section-desc">
        Add a new fellow, or select one below to update their photo, biography, or which fellowship
        level they hold.
      </p>

      {error && <p className="control-status control-status--error">{error}</p>}

      {fellows !== null && (
        <div className="control-fellow-picker">
          <button
            type="button"
            className={`control-kind-btn${selectedId === 'add' ? ' active' : ''}`}
            onClick={() => selectFellow('add')}
          >
            <span className="control-kind-label">+ Add new fellow</span>
          </button>
          {fellows.length > 0 && (
            <select
              className="control-restore-select"
              value={selectedId === 'add' ? '' : selectedId}
              onChange={(e) => selectFellow(Number(e.target.value))}
            >
              <option value="" disabled>
                Or edit an existing fellow…
              </option>
              {fellows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.level})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="control-upload-form control-fellow-form">
        <label className="control-file-label">
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </label>

        <label className="control-file-label">
          <span>Fellowship level</span>
          <select
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            required
          >
            {FELLOW_LEVELS.map((level) => (
              <option key={level.code} value={level.code}>
                {level.code} — {level.name}
              </option>
            ))}
          </select>
        </label>

        <label className="control-file-label">
          <span>Biography</span>
          <textarea
            rows={4}
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </label>

        <label className="control-file-label">
          <span>{currentFellow ? 'Replace photo' : 'Photo'}</span>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif,.bmp"
            onChange={(e) => {
              setPhotoFile(e.target.files[0] || null);
              setRemovePhoto(false);
            }}
          />
          <span className="control-fellow-photo-note">
            Any image works — it's automatically cropped and resized to a standard headshot format.
          </span>
        </label>

        {currentFellow?.photo && !photoFile && (
          <label className="control-fellow-remove-photo">
            <input
              type="checkbox"
              checked={removePhoto}
              onChange={(e) => setRemovePhoto(e.target.checked)}
            />
            <span>Remove current photo</span>
          </label>
        )}

        <div className="control-fellow-actions">
          <button type="submit" className="control-btn" disabled={submitting}>
            {submitting ? 'Saving…' : currentFellow ? 'Save changes' : 'Add fellow'}
          </button>
          {currentFellow && (
            <button
              type="button"
              className="control-btn control-btn--danger"
              disabled={submitting}
              onClick={handleDelete}
            >
              Remove from roster
            </button>
          )}
        </div>
      </form>

      {status && (
        <p className={`control-status control-status--${status.type}`}>{status.message}</p>
      )}
    </section>
  );
}