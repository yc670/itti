import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ReportCard from '../components/ReportCard.jsx';
import ReportUploadForm from './ReportUploadForm.jsx';
import ResubmitReportForm from './ResubmitReportForm.jsx';
import Reveal from '../components/Reveal.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';
import ControlPanel from '../components/ControlPanel.jsx';
import SEO from '../components/SEO.jsx';
import Avatar from '../components/Avatar.jsx';
import {
  fetchSavedObservatoryCharts, deleteSavedObservatoryChart,
  fetchFavoriteReports, unfavoriteReport,
  fetchMyReports, csrfFetch,
} from '../api.js';
import '../styles/Profile.css';

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const REVIEW_STATUS_LABEL = {
  published: { label: 'Published', className: 'published' },
  pending_review: { label: 'Pending Review', className: 'pending' },
  changes_requested: { label: 'Changes Requested', className: 'changes' },
  rejected: { label: 'Not Approved', className: 'rejected' },
};

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'publications', label: 'Publications' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'settings', label: 'Settings' },
];
// Admin-only, appended in the component below rather than listed here
// directly - keeps this base list meaningful on its own and the
// role check colocated with the one place it's used.
const CONTROL_TAB = { key: 'control', label: 'Control' };

function SavedChartCard({ chart, onDelete }) {
  const config = chart.config || {};
  const panelCount = Array.isArray(config.panels) ? config.panels.length : 0;
  const countryCount = Array.isArray(config.panels)
    ? new Set(config.panels.map((p) => p.countryCode)).size
    : 0;

  return (
    <Link to={`/observatory?chart=${chart.id}`} className="profile-chart-card">
      <div className="profile-chart-card-head">
        <span className={`profile-chart-badge indicator-${chart.indicator.toLowerCase()}`}>{chart.indicator}</span>
        <button
          type="button"
          className="profile-chart-delete"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(chart.id); }}
          aria-label="Delete saved chart"
        >
          ✕
        </button>
      </div>
      <h4 className="profile-chart-title">{chart.title}</h4>
      <p className="profile-chart-meta">
        {config.chartType ? `${config.chartType} · ` : ''}
        {panelCount} panel{panelCount === 1 ? '' : 's'}
        {countryCount > 0 ? ` · ${countryCount} countr${countryCount === 1 ? 'y' : 'ies'}` : ''}
      </p>
      <p className="profile-chart-date">Saved {formatDate(chart.created_at)}</p>
      <span className="profile-chart-card-cta">Open in Observatory &rarr;</span>
    </Link>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const canPublish = user?.role === 'publisher' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? [...TABS, CONTROL_TAB] : TABS;

  const { hash } = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => {
    // /profile#favorites lands directly on that tab instead of always
    // defaulting to Profile - useful for a direct link from the README,
    // an email, etc. Falls back to 'profile' for an empty/unrecognized
    // hash rather than silently landing on nothing.
    const key = hash?.slice(1);
    return tabs.some((t) => t.key === key) ? key : 'profile';
  });

  // Also react to the hash changing while already on the page (e.g. the
  // user clicks a #favorites link elsewhere in the app without a full
  // reload) - the lazy useState above only runs once, on mount.
  useEffect(() => {
    const key = hash?.slice(1);
    if (key && tabs.some((t) => t.key === key)) {
      setActiveTab(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const [charts, setCharts] = useState(null); // null = loading
  const [chartsError, setChartsError] = useState(null);

  const [favoriteReports, setFavoriteReports] = useState(null);
  const [favoritesError, setFavoritesError] = useState(null);

  const [myReports, setMyReports] = useState(null);
  const [myReportsError, setMyReportsError] = useState(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [resubmittingId, setResubmittingId] = useState(null);

  const [notifications, setNotifications] = useState(null); // null = loading
  const [notificationsError, setNotificationsError] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // Selection for the Notifications tab's bulk "Mark as read" / "Delete"
  // actions - a Set of notification ids, cleared whenever the list is
  // reloaded (ids can go stale otherwise, e.g. after a delete).
  const [selectedNotificationIds, setSelectedNotificationIds] = useState(() => new Set());
  const [bulkActionPending, setBulkActionPending] = useState(false);

  useEffect(() => {
    fetchSavedObservatoryCharts()
      .then(setCharts)
      .catch((err) => setChartsError(err.message));
  }, []);

  useEffect(() => {
    fetchFavoriteReports()
      .then(setFavoriteReports)
      .catch((err) => setFavoritesError(err.message));
  }, []);

  useEffect(() => {
    if (!canPublish) return;
    loadMyReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish]);

  function loadMyReports() {
    fetchMyReports()
      .then(setMyReports)
      .catch((err) => setMyReportsError(err.message));
  }

  function loadNotifications() {
    fetch('/api/notifications', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setNotifications(data);
        // Ids from a stale list shouldn't linger selected against a
        // freshly-loaded one (e.g. after a delete removes some rows).
        setSelectedNotificationIds(new Set());
      })
      .catch((err) => setNotificationsError(err.message));
  }

  function loadUnreadCount() {
    fetch('/api/notifications/unread-count', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setUnreadCount(data.unread_count))
      .catch(() => {});
  }

  useEffect(() => {
    loadNotifications();
    loadUnreadCount();
  }, []);

  async function handleNotificationClick(notification) {
    if (!notification.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        await csrfFetch(`/api/notifications/${notification.id}/read`, { method: 'POST' });
      } catch {
        // Non-critical - worst case it shows as unread again next load.
      }
    }
    if (notification.report_id) {
      navigate(`/peer-review/mine?highlight=${notification.report_id}`);
    }
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev?.map((n) => ({ ...n, is_read: true })) ?? prev); // optimistic
    setUnreadCount(0);
    setSelectedNotificationIds(new Set());
    try {
      await csrfFetch('/api/notifications/read-all', { method: 'POST' });
    } catch {
      loadNotifications();
      loadUnreadCount();
    }
  }

  function toggleNotificationSelected(id) {
    setSelectedNotificationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllNotifications() {
    setSelectedNotificationIds((prev) => {
      if (notifications && prev.size === notifications.length) return new Set(); // all selected -> clear
      return new Set((notifications || []).map((n) => n.id));
    });
  }

  /** Marks every currently-selected notification read, then clears the selection. */
  async function handleMarkSelectedRead() {
    const ids = Array.from(selectedNotificationIds);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const unreadAmongSelected = (notifications || []).filter((n) => idSet.has(n.id) && !n.is_read).length;
    setNotifications((prev) => prev?.map((n) => (idSet.has(n.id) ? { ...n, is_read: true } : n)) ?? prev); // optimistic
    setUnreadCount((prev) => Math.max(0, prev - unreadAmongSelected)); // optimistic - loadUnreadCount() below reconciles either way
    setSelectedNotificationIds(new Set());
    setBulkActionPending(true);
    try {
      await csrfFetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // fall back to a fresh fetch so state can't drift from the server
    } finally {
      loadNotifications();
      loadUnreadCount();
      setBulkActionPending(false);
    }
  }

  /** Deletes every currently-selected notification, then clears the selection. */
  async function handleDeleteSelected() {
    const ids = Array.from(selectedNotificationIds);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const unreadAmongSelected = (notifications || []).filter((n) => idSet.has(n.id) && !n.is_read).length;
    setNotifications((prev) => prev?.filter((n) => !idSet.has(n.id)) ?? prev); // optimistic
    setUnreadCount((prev) => Math.max(0, prev - unreadAmongSelected)); // optimistic - loadUnreadCount() below reconciles either way
    setSelectedNotificationIds(new Set());
    setBulkActionPending(true);
    try {
      await csrfFetch('/api/notifications/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // fall back to a fresh fetch so state can't drift from the server
    } finally {
      loadNotifications();
      loadUnreadCount();
      setBulkActionPending(false);
    }
  }

  async function handleDeleteChart(chartId) {
    setCharts((prev) => prev.filter((c) => c.id !== chartId)); // optimistic
    try {
      await deleteSavedObservatoryChart(chartId);
    } catch {
      fetchSavedObservatoryCharts().then(setCharts).catch(() => {}); // revert by re-fetching
    }
  }

  async function handleUnfavoriteReport(reportId) {
    setFavoriteReports((prev) => prev.filter((r) => r.id !== reportId)); // optimistic
    try {
      await unfavoriteReport(reportId);
    } catch {
      fetchFavoriteReports().then(setFavoriteReports).catch(() => {});
    }
  }

  function handleReportUploaded() {
    setShowUploadForm(false);
    loadMyReports();
  }

  function handleReportResubmitted() {
    setResubmittingId(null);
    loadMyReports();
  }

  if (!user) return null;

  return (
    <div className="profile-page">
      <SEO path="/profile" title="Profile" noindex />
      <div className="profile-layout">
        {/* ---------- Vertical nav ---------- */}
        <nav className="profile-sidebar" aria-label="Profile sections">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`profile-sidebar-link${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => { setActiveTab(tab.key); navigate(`#${tab.key}`, { replace: true }); }}
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              {tab.label}
              {tab.key === 'notifications' && unreadCount > 0 && (
                <span className="profile-sidebar-badge">{unreadCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="profile-content">
          {/* ---------- Profile ---------- */}
          {activeTab === 'profile' && (
            <Reveal delay={0}>
              <section className="profile-header">
                <Avatar name={user.name} email={user.email} pictureUrl={user.picture_url} className="profile-avatar" />
                <div className="profile-header-info">
                  <h1 className="profile-name display">{user.name || user.email}</h1>
                  <p className="profile-email">{user.email}</p>
                  <div className="profile-header-meta">
                    <span className={`role-badge role-${user.role}`}>{user.role}</span>
                    {user.created_at && <span className="profile-member-since">Member since {formatDate(user.created_at)}</span>}
                  </div>
                </div>
              </section>
            </Reveal>
          )}

          {/* ---------- Favorites ---------- */}
          {activeTab === 'favorites' && (
            <Reveal delay={0}>
              <section className="profile-section">
                <h2 className="profile-section-title display">Favorites</h2>

                <h3 className="profile-subsection-title">Observatory charts</h3>
                {chartsError && <p className="profile-error">{chartsError}</p>}
                {!chartsError && charts === null && <p className="profile-status">Loading saved charts…</p>}
                {!chartsError && charts !== null && charts.length === 0 && (
                  <div className="profile-empty">
                    <p>No saved charts yet.</p>
                    <Link to="/observatory" className="btn btn-secondary">Go to Observatory</Link>
                  </div>
                )}
                {!chartsError && charts !== null && charts.length > 0 && (
                  <div className="profile-charts-grid">
                    {charts.map((chart) => (
                      <SavedChartCard key={chart.id} chart={chart} onDelete={handleDeleteChart} />
                    ))}
                  </div>
                )}

                <h3 className="profile-subsection-title">Reports</h3>
                {favoritesError && <p className="profile-error">{favoritesError}</p>}
                {!favoritesError && favoriteReports === null && <p className="profile-status">Loading favorite reports…</p>}
                {!favoritesError && favoriteReports !== null && favoriteReports.length === 0 && (
                  <div className="profile-empty">
                    <p>No favorited reports yet.</p>
                    <Link to="/reports/browse" className="btn btn-secondary">Browse Reports</Link>
                  </div>
                )}
                {!favoritesError && favoriteReports !== null && favoriteReports.length > 0 && (
                  <div className="profile-reports-grid">
                    {favoriteReports.map((report) => (
                      <div key={report.id} className="profile-favorite-report">
                        <ReportCard
                          report={report}
                          canManage={false}
                          isFavorited
                          onToggleFavorite={handleUnfavoriteReport}
                          onRead={(r) => navigate(`/reports/${r.id}`)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </Reveal>
          )}

          {/* ---------- Publications ---------- */}
          {activeTab === 'publications' && (
            <Reveal delay={0}>
              <section className="profile-section">
                <div className="profile-section-head">
                  <h2 className="profile-section-title display">Publications</h2>
                  {canPublish && (
                    <div className="profile-publications-actions">
                      <Link to="/peer-review/mine" className="btn btn-secondary">
                        Peer Review
                      </Link>
                      {!showUploadForm && (
                        <button type="button" className="btn btn-primary" onClick={() => setShowUploadForm(true)}>
                          New Report
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {!canPublish && (
                  <div className="profile-callout">
                    <p>Publishing is available to Publisher accounts.</p>
                    <p>
                      To request access, contact{' '}
                      <a href="mailto:contact@itti.org">contact@itti.org</a>.
                    </p>
                  </div>
                )}

                {canPublish && showUploadForm && (
                  <ReportUploadForm onUploaded={handleReportUploaded} onCancel={() => setShowUploadForm(false)} />
                )}

                {canPublish && (
                  <>
                    {myReportsError && <p className="profile-error">{myReportsError}</p>}
                    {!myReportsError && myReports === null && <p className="profile-status">Loading your publications…</p>}
                    {!myReportsError && myReports !== null && myReports.length === 0 && !showUploadForm && (
                      <p className="profile-status">You haven't published any reports yet.</p>
                    )}
                    {!myReportsError && myReports !== null && myReports.length > 0 && (
                      <div className="profile-publications-list">
                        {myReports.map((report) => {
                          const statusInfo = REVIEW_STATUS_LABEL[report.review_status] || { label: report.review_status, className: '' };
                          const badge = (
                            <span className={`profile-status-badge ${statusInfo.className}`}>{statusInfo.label}</span>
                          );
                          const needsChanges = report.review_status === 'changes_requested';
                          const isRejected = report.review_status === 'rejected';
                          const isPending = report.review_status === 'pending_review';
                          return (
                            <div key={report.id} className="profile-publication-item">
                              <div className="profile-publication-row">
                                <div className="profile-publication-info">
                                  <span className="profile-publication-title">{report.title}</span>
                                  <span className="profile-publication-date">{formatDate(report.created_at)} · v{report.version}</span>
                                </div>
                                <div className="profile-publication-row-right">
                                  {needsChanges || isRejected ? (
                                    <Link to={`/peer-review/mine?highlight=${report.id}`} className="profile-publication-status-link">
                                      {badge}
                                      <span className="profile-publication-status-link-text">See why &rarr;</span>
                                    </Link>
                                  ) : (
                                    badge
                                  )}
                                  {needsChanges && resubmittingId !== report.id && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary profile-publication-resubmit-btn"
                                      onClick={() => setResubmittingId(report.id)}
                                    >
                                      Resubmit
                                    </button>
                                  )}
                                  {isPending && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary profile-publication-resubmit-btn"
                                      onClick={() => navigate(`/reports/${report.id}/edit`)}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </div>
                              {needsChanges && resubmittingId === report.id && (
                                <ResubmitReportForm
                                  report={report}
                                  onResubmitted={handleReportResubmitted}
                                  onCancel={() => setResubmittingId(null)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>
            </Reveal>
          )}

          {/* ---------- Notifications ---------- */}
          {activeTab === 'notifications' && (
            <Reveal delay={0}>
              <section className="profile-section">
                <div className="profile-section-head">
                  <h2 className="profile-section-title display">Notifications</h2>
                  {notifications !== null && unreadCount > 0 && selectedNotificationIds.size === 0 && (
                    <button type="button" className="btn btn-secondary" onClick={handleMarkAllRead}>
                      Mark all as read
                    </button>
                  )}
                </div>

                {notificationsError && <p className="profile-error">{notificationsError}</p>}
                {!notificationsError && notifications === null && (
                  <p className="profile-status">Loading notifications…</p>
                )}
                {!notificationsError && notifications !== null && notifications.length === 0 && (
                  <p className="profile-status">You don't have any notifications yet.</p>
                )}
                {!notificationsError && notifications !== null && notifications.length > 0 && (
                  <>
                    <div className="profile-notifications-toolbar">
                      <label className="profile-notifications-select-all">
                        <input
                          type="checkbox"
                          checked={selectedNotificationIds.size === notifications.length}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate =
                                selectedNotificationIds.size > 0 && selectedNotificationIds.size < notifications.length;
                            }
                          }}
                          onChange={toggleSelectAllNotifications}
                        />
                        {selectedNotificationIds.size > 0
                          ? `${selectedNotificationIds.size} selected`
                          : 'Select all'}
                      </label>
                      {selectedNotificationIds.size > 0 && (
                        <div className="profile-notifications-bulk-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={bulkActionPending}
                            onClick={handleMarkSelectedRead}
                          >
                            Mark as read
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary profile-notifications-delete-btn"
                            disabled={bulkActionPending}
                            onClick={handleDeleteSelected}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="profile-notifications-list">
                      {notifications.map((notification) => {
                        const clickable = notification.report_id != null;
                        const selected = selectedNotificationIds.has(notification.id);
                        return (
                          <div
                            key={notification.id}
                            className={`profile-notification-row${notification.is_read ? '' : ' unread'}${selected ? ' selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              className="profile-notification-checkbox"
                              checked={selected}
                              onChange={() => toggleNotificationSelected(notification.id)}
                              aria-label="Select notification"
                            />
                            <button
                              type="button"
                              className={`profile-notification-main${clickable ? ' clickable' : ''}`}
                              onClick={clickable ? () => handleNotificationClick(notification) : undefined}
                              disabled={!clickable}
                            >
                              {!notification.is_read && <span className="profile-notification-dot" aria-hidden="true" />}
                              <div className="profile-notification-body">
                                <p className="profile-notification-message">{notification.message}</p>
                                <span className="profile-notification-date">{formatDate(notification.created_at)}</span>
                              </div>
                              {clickable && <span className="profile-notification-cta">See in Peer Review &rarr;</span>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </Reveal>
          )}

          {/* ---------- Settings ---------- */}
          {activeTab === 'settings' && (
            <section className="profile-section profile-settings-section">
              <h2 className="profile-section-title display">Settings</h2>
              <SettingsPanel />
            </section>
          )}

          {/* ---------- Control (admin only) ---------- */}
          {activeTab === 'control' && isAdmin && (
            <section className="profile-section profile-settings-section">
              <h2 className="profile-section-title display">Control</h2>
              <p className="profile-section-desc">
                Upload replacement data files for the Observatory and Country Profiles. Every
                upload is validated before anything changes, and the file it replaces is kept
                (not deleted) for version history.
              </p>
              <ControlPanel />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}