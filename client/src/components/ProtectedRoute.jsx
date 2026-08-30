import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 *   <ProtectedRoute><Dashboard /></ProtectedRoute>
 *   <ProtectedRoute requireRole="publisher"><Publish /></ProtectedRoute>
 *
 * Re-verifies the session fresh with the server (via checkSession() in
 * AuthContext.jsx) on every mount, rather than trusting whatever
 * isAuthenticated already holds in React state. Without this, a session
 * that expired from inactivity (see SESSION_INACTIVITY_TIMEOUT in
 * server/decorators.py) between AuthContext's periodic poll (up to 5
 * minutes stale - see SESSION_CHECK_POLL_MS) and the moment someone
 * navigates here would leave isAuthenticated sitting on a stale `true`,
 * letting them through to a page whose own data-fetching then just
 * fails silently instead of prompting them to log back in - which is
 * exactly the gap this component exists to close.
 */
export default function ProtectedRoute({ children, requireRole }) {
  const { isAuthenticated, user, loading, checkSession } = useAuth();
  const location = useLocation();
  // null = still verifying, true/false = verified result. Starts as
  // isAuthenticated's current (possibly stale) value so a genuinely
  // already-logged-in user doesn't see a flash of "checking..." on
  // every single navigation - just re-confirmed a moment later.
  const [verifiedAuthenticated, setVerifiedAuthenticated] = useState(isAuthenticated);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkSession().then(({ authenticated, reason }) => {
      if (cancelled) return;
      setVerifiedAuthenticated(authenticated);
      if (!authenticated && reason === 'session_expired') setSessionExpired(true);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately re-runs on every navigation to a protected route
    // (location.key changes on every navigation, including to the same
    // path) - a stale check from a previous protected page shouldn't be
    // reused for a different one reached later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  if (loading || verifiedAuthenticated === null) return null; // could swap for a spinner

  if (!verifiedAuthenticated) {
    return (
      <Navigate
        to="/login"
        state={{ from: location, sessionExpired: sessionExpired || undefined }}
        replace
      />
    );
  }
  // admin satisfies any requireRole - mirrors the backend, where every
  // @roles_required("publisher", ...) route also allows "admin" (see
  // docs/ACCESS_LEVELS.md: admin can do everything publisher can).
  if (requireRole && user?.role !== requireRole && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}