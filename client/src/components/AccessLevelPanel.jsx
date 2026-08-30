import { useEffect, useRef, useState } from 'react';
import { fetchAdminUsers, updateUserRoles } from '../api.js';

const PAGE_SIZE = 20;
const ROLE_OPTIONS = ['basic', 'publisher', 'reviewer', 'admin'];

/**
 * Admin-only account list backing the Control tab's role management -
 * search by name/email, 20 accounts per page, change a role straight
 * from its row's dropdown (confirmed via a modal before it's sent).
 *
 * The search bar re-fetches on every keystroke (no debounce) per the
 * feature request - a requestId guard below just makes sure a slower,
 * earlier keystroke's response can't land after a faster, later one
 * and show stale results.
 */
export default function AccessLevelPanel() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The change a row's dropdown just proposed, awaiting confirmation - or
  // null when no modal should show. { user, newRole }
  const [pendingChange, setPendingChange] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetchAdminUsers({ search, limit: PAGE_SIZE, offset })
      .then(({ users: page, total: matchCount }) => {
        if (requestId !== requestIdRef.current) return; // a newer request already landed
        setUsers(page);
        setTotal(matchCount);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err.message);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [search, offset]);

  function handleSearchChange(e) {
    setSearch(e.target.value);
    setOffset(0); // a changed search always starts back at page 1
  }

  function handleRoleSelect(user, newRole) {
    if (newRole === user.role) return;
    setSaveError(null);
    setPendingChange({ user, newRole });
  }

  function cancelChange() {
    if (saving) return;
    setPendingChange(null);
    setSaveError(null);
  }

  async function confirmChange() {
    if (!pendingChange) return;
    const { user, newRole } = pendingChange;
    setSaving(true);
    setSaveError(null);
    try {
      await updateUserRoles([{ user_id: user.id, role: newRole }]);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
      setPendingChange(null);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrev = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <section className="control-section access-level-panel">
      <h3>Access Level</h3>
      <p className="control-section-desc">
        Search for an account by name or email, then pick a new access level from its dropdown.
        Changes take effect on that person's next request.
      </p>

      <input
        type="text"
        className="access-level-search"
        placeholder="Search by name or email…"
        value={search}
        onChange={handleSearchChange}
        aria-label="Search accounts by name or email"
      />

      {error && <p className="control-status control-status--error">{error}</p>}

      <div className="access-level-table-wrap">
        <table className="access-level-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Access level</th>
            </tr>
          </thead>
          <tbody>
            {!error && loading && users.length === 0 && (
              <tr>
                <td colSpan={3} className="access-level-empty">Loading accounts…</td>
              </tr>
            )}
            {!error && !loading && users.length === 0 && (
              <tr>
                <td colSpan={3} className="access-level-empty">
                  {search ? `No accounts match "${search}".` : 'No accounts found.'}
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id} className={loading ? 'access-level-row--stale' : undefined}>
                <td>{user.name || <span className="access-level-noname">—</span>}</td>
                <td>{user.email}</td>
                <td>
                  <select
                    className={`access-level-select role-${user.role}`}
                    value={user.role}
                    onChange={(e) => handleRoleSelect(user, e.target.value)}
                    disabled={saving}
                    aria-label={`Access level for ${user.name || user.email}`}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="access-level-pagination">
        <button
          type="button"
          className="control-btn control-btn--secondary"
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          disabled={!canGoPrev || loading}
        >
          Previous
        </button>
        <span className="access-level-page-info">
          Page {page} of {pageCount} · {total} account{total === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="control-btn control-btn--secondary"
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          disabled={!canGoNext || loading}
        >
          Next
        </button>
      </div>

      {pendingChange && (
        <div className="access-level-modal-overlay" role="presentation" onClick={cancelChange}>
          <div
            className="access-level-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-level-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="access-level-modal-title">Confirm access level change</h4>
            <p>
              Change <strong>{pendingChange.user.name || pendingChange.user.email}</strong>'s access level
              from <strong>{pendingChange.user.role}</strong> to <strong>{pendingChange.newRole}</strong>?
            </p>
            {saveError && <p className="control-status control-status--error">{saveError}</p>}
            <div className="access-level-modal-actions">
              <button type="button" className="control-btn control-btn--secondary" onClick={cancelChange} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="control-btn" onClick={confirmChange} disabled={saving}>
                {saving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}