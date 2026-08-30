import { Link } from 'react-router-dom';

/**
 * Small admin-only Control tab panel that just links out to the full
 * Deleted Reports page (/admin/deleted-reports) - unlike
 * ReportCategoryControl (an inline searchable table right here in the
 * Control tab), the Deleted Reports view needs its own categorized
 * layout and bulk-select actions (hard delete / repost), which don't
 * fit naturally as one more panel squeezed into this tab. This
 * component (rendered by ControlPanel.jsx, which is itself already
 * admin-only - see Profile.jsx's isAdmin check) is just the entry
 * point into that page.
 */
export default function DeletedReportsControl() {
  return (
    <section className="control-section">
      <h3>Deleted reports</h3>
      <p className="control-section-desc">
        Every report that was published and later removed - whether a publisher requested its deletion (approved by
        a reviewer) or an admin removed it directly. Repost to restore a report exactly as it was, or permanently
        erase it from the database.
      </p>
      <Link to="/admin/deleted-reports" className="control-btn">
        See deleted reports
      </Link>
    </section>
  );
}