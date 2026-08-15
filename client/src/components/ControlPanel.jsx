import { useEffect, useState } from 'react';
import Reveal from './Reveal.jsx';
import FellowsControl from './FellowsControl.jsx';
import AccessLevelPanel from './AccessLevelPanel.jsx';
import ReportCategoryControl from './ReportCategoryControl.jsx';
import '../styles/Control.css';

const OBSERVATORY_KIND_OPTIONS = [
  { value: 'GTBI', label: 'GTBI', description: 'Global Trauma Burden Index workbook (.xlsx)' },
  { value: 'ETTI', label: 'ETTI', description: 'Election Trauma Temperature Index workbook (.xlsx)' },
];

const PROFILE_KIND_OPTIONS = [
  { value: 'survey', label: 'Country Trauma Profiles', description: 'Full per-country narrative + reference (.docx)' },
  { value: 'dashboard', label: 'One-Page Dashboard Profiles', description: 'Companion set tied to GTBI/ETTI figures (.docx)' },
];

function formatUploadedAt(isoString) {
  if (!isoString) return 'unknown time';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * The "restore a previous version" dropdown for one kind - fetches
 * `historyEndpoint?kind=` whenever `kind` changes and lets the admin
 * pick one of the archived files back into place via `restoreEndpoint`.
 * Kept separate from <UploadSection> below (rather than one giant
 * component) since it has its own independent fetch/submit/status
 * lifecycle that has nothing to do with the upload form's.
 */
function RestoreSection({ kind, historyEndpoint, restoreEndpoint, describeSuccess, onRestored }) {
  const [uploads, setUploads] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUploads(null);
    setError(null);
    setSelected('');
    setStatus(null);

    fetch(`${historyEndpoint}?kind=${encodeURIComponent(kind)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(data.description || data.error || 'Could not load version history');
        return data;
      })
      .then((data) => {
        if (!cancelled) setUploads(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, historyEndpoint]);

  async function handleRestore() {
    if (!selected) return;
    setRestoring(true);
    setStatus(null);
    try {
      const res = await fetch(restoreEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, filename: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.description || data.error || 'Restore failed');
      }
      setStatus({ type: 'success', message: describeSuccess(data) });
      onRestored?.();
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="control-restore">
      <span className="control-restore-label">Or restore a previous version</span>

      {error && <p className="control-status control-status--error">{error}</p>}

      {!error && uploads === null && <p className="control-restore-status">Loading version history…</p>}

      {!error && uploads !== null && uploads.length === 0 && (
        <p className="control-restore-status">No previous uploads for this file yet.</p>
      )}

      {!error && uploads !== null && uploads.length > 0 && (
        <div className="control-restore-row">
          <select
            className="control-restore-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a version…</option>
            {uploads.map((u) => (
              <option key={u.filename} value={u.filename}>
                {u.original_filename} — {formatUploadedAt(u.uploaded_at)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="control-btn control-btn--secondary"
            disabled={!selected || restoring}
            onClick={handleRestore}
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      )}

      {status && (
        <p className={`control-status control-status--${status.type}`}>{status.message}</p>
      )}
    </div>
  );
}

/**
 * One <UploadSection> instance per upload target (Observatory
 * GTBI/ETTI workbooks, country-profile docx files) - same
 * kind-choice-then-file-picker shape as the standalone
 * PublishGlobeData.jsx page, just parameterized so this one component
 * covers both without duplicating the form logic. `endpoint` handles
 * its own kind of validate -> archive -> rotate -> regenerate pipeline
 * server-side (globe_data.py / country_profiles_upload.py); this
 * component only needs to know the endpoint, the kind options, the
 * accepted file extension, and how to phrase a successful result.
 * Once a kind is chosen, <RestoreSection> underneath offers picking an
 * older version instead of uploading a new one - it's remounted (via
 * `key`) on every successful upload/restore so its own history list
 * refetches and immediately includes what just changed.
 */
function UploadSection({ title, description, endpoint, historyEndpoint, restoreEndpoint, kindOptions, accept, describeSuccess }) {
  const [kind, setKind] = useState(null);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message }
  const [submitting, setSubmitting] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0); // bumped to force RestoreSection to refetch

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
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.description || data.error || 'Upload failed');
      }

      setStatus({ type: 'success', message: describeSuccess(data) });
      setFile(null);
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="control-section">
      <h3>{title}</h3>
      <p className="control-section-desc">{description}</p>

      <div className="control-kind-choice">
        {kindOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`control-kind-btn${kind === opt.value ? ' active' : ''}`}
            onClick={() => handleKindSelect(opt.value)}
          >
            <span className="control-kind-label">{opt.label}</span>
            <span className="control-kind-desc">{opt.description}</span>
          </button>
        ))}
      </div>

      {kind && (
        <>
          <form onSubmit={handleSubmit} className="control-upload-form">
            <label className="control-file-label">
              <span>Replacement file</span>
              <input type="file" accept={accept} onChange={handleFileChange} required />
            </label>
            <button type="submit" className="control-btn" disabled={!file || submitting}>
              {submitting ? 'Processing…' : 'Upload'}
            </button>
          </form>

          {status && (
            <p className={`control-status control-status--${status.type}`}>{status.message}</p>
          )}

          <RestoreSection
            key={`${kind}-${historyVersion}`}
            kind={kind}
            historyEndpoint={historyEndpoint}
            restoreEndpoint={restoreEndpoint}
            describeSuccess={describeSuccess}
            onRestored={() => setHistoryVersion((v) => v + 1)}
          />
        </>
      )}
    </section>
  );
}

/**
 * Admin-only tab on the Profile page (see isAdmin in Profile.jsx -
 * user.role === 'admin', same check every endpoint this component
 * calls enforces server-side). Lets an admin push a replacement
 * Observatory workbook or country-profile document straight from the
 * browser, or roll back to any earlier one, instead of needing shell
 * access to run the CLI scripts in server/data_scripts/ by hand.
 *
 * Both upload AND restore follow the same on-disk pattern: the file is
 * validated before anything changes, the previous canonical file for
 * that kind is moved into an old/ subfolder (timestamped) rather than
 * overwritten - so every past version stays recoverable, restoring one
 * is itself just another entry in that same history - and the derived
 * JSON the rest of the site actually reads
 * (server/data/country_data.json, server/data/country_profiles.json)
 * is regenerated immediately, so the change is live without a
 * redeploy. See globe_data.py and country_profiles_upload.py for the
 * exact steps.
 */
export default function ControlPanel() {
  return (
    <>
      <Reveal delay={0}>
        <UploadSection
          title="Observatory data"
          description="Replace the GTBI or ETTI workbook the globe, Observatory, and Country Profiles dashboard figures are built from."
          endpoint="/api/globe-data/upload"
          historyEndpoint="/api/globe-data/uploads"
          restoreEndpoint="/api/globe-data/restore"
          kindOptions={OBSERVATORY_KIND_OPTIONS}
          accept=".xlsx"
          describeSuccess={(data) =>
            `${data.kind} data updated for ${data.countries_updated.length} countries.`
          }
        />
      </Reveal>

      <Reveal delay={60}>
        <UploadSection
          title="Country profiles"
          description="Replace one of the two source documents the Country Profiles page's narrative text is built from."
          endpoint="/api/country-profiles/upload"
          historyEndpoint="/api/country-profiles/uploads"
          restoreEndpoint="/api/country-profiles/restore"
          kindOptions={PROFILE_KIND_OPTIONS}
          accept=".docx"
          describeSuccess={(data) =>
            `${data.profile_count} country profiles regenerated (${data.with_dashboard_note_count} with a dashboard note)`
            + (data.skipped.length > 0 ? ` - skipped: ${data.skipped.join(', ')}.` : '.')
          }
        />
      </Reveal>

      <Reveal delay={120}>
        <FellowsControl />
      </Reveal>

      <Reveal delay={180}>
        <ReportCategoryControl />
      </Reveal>

      <Reveal delay={240}>
        <AccessLevelPanel />
      </Reveal>
    </>
  );
}