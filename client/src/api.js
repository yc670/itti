const API_BASE = '/api';

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function fetchWorldData() {
  return getJson('/world-data');
}

export function fetchAllCountries() {
  return getJson('/countries');
}

export function fetchCountry(isoCode) {
  return getJson(`/countries/${isoCode}`);
}

async function sendJson(path, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.description || data.error || `Request to ${path} failed`);
  }
  return data;
}

/** title: string, indicator: "ETTI"|"GTBI"|"mixed", config: plain object describing the chart. */
export function saveObservatoryChart(title, indicator, config) {
  return sendJson("/observatory/saved-charts", "POST", { title, indicator, config });
}

export function fetchSavedObservatoryCharts() {
  return sendJson("/observatory/saved-charts", "GET");
}

export function fetchSavedObservatoryChart(chartId) {
  return sendJson(`/observatory/saved-charts/${chartId}`, "GET");
}

export function deleteSavedObservatoryChart(chartId) {
  return sendJson(`/observatory/saved-charts/${chartId}`, "DELETE");
}

/** The logged-in user's own uploaded reports, any review_status. */
export function fetchMyReports() {
  return sendJson("/reports/mine", "GET");
}

/** The logged-in user's favorited reports, full report objects. */
export function fetchFavoriteReports() {
  return sendJson("/reports/favorites", "GET");
}

/** Just the id set - cheap for marking stars on a list of report cards. */
export function fetchFavoriteReportIds() {
  return sendJson("/reports/favorites/ids", "GET");
}

export function favoriteReport(reportId) {
  return sendJson(`/reports/${reportId}/favorite`, "POST");
}

export function unfavoriteReport(reportId) {
  return sendJson(`/reports/${reportId}/favorite`, "DELETE");
}

/**
 * search/limit/offset all optional. Unlike the other list endpoints
 * above, this one's total count lives in a response header
 * (X-Total-Count) rather than the body, so it can't reuse getJson -
 * the Access Level panel needs that total to render "Page X of Y" /
 * disable Next past the last page.
 */
export async function fetchAdminUsers({ search = "", limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set("search", search);

  const res = await fetch(`${API_BASE}/admin/users?${params.toString()}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.description || data.error || "Request to /admin/users failed");
  }
  return { users: data, total: Number(res.headers.get("X-Total-Count")) || 0 };
}

/** changes: [{ user_id, role }, ...]. Returns the updated User objects. */
export function updateUserRoles(changes) {
  return sendJson("/admin/users/roles", "POST", { changes });
}

/**
 * Admin-only: every report regardless of review_status or hidden
 * status, for the Control tab's recategorize tool. Same
 * header-based-total shape as fetchAdminUsers above, for the same
 * reason (pagination needs a total independent of the page body).
 */
export async function fetchAllReportsAdmin({ search = "", category = "", limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set("search", search);
  if (category) params.set("category", category);

  const res = await fetch(`${API_BASE}/reports/all?${params.toString()}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.description || data.error || "Request to /reports/all failed");
  }
  return { reports: data, total: Number(res.headers.get("X-Total-Count")) || 0 };
}

/** Admin-only: updates just a report's category. Returns the updated report. */
export function updateReportCategory(reportId, category) {
  return sendJson(`/reports/${reportId}/category`, "PATCH", { category });
}