import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { csrfFetch } from '../api.js';

export const AuthContext = createContext(null);

// How often to re-check /api/auth/me while logged in, purely to detect
// a session that expired from inactivity (see
// SESSION_INACTIVITY_TIMEOUT in server/decorators.py) while the user
// is sitting on a page that isn't itself making any requests - e.g.
// reading a long report with no further clicks. Deliberately shorter
// than the 30-minute server-side timeout (same "poll a few times
// within the window" reasoning as NavBar.jsx's own notification
// polling) so the redirect happens reasonably soon after the actual
// expiry rather than the user only discovering it is logged out the
// next time they happen to click something.
const SESSION_CHECK_POLL_MS = 5 * 60 * 1000;

async function postJson(path, body) {
  const res = await csrfFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.description || data.error || `Request to ${path} failed`);
    // Some routes (e.g. /api/auth/login's email_not_verified response)
    // return extra fields beyond error/description - attach the whole
    // body so a caller that needs them (e.g. Login.jsx redirecting to
    // the verify-email screen with the right email pre-filled) can read
    // error.data.<field> without every other caller needing to change.
    error.data = data;
    throw error;
  }
  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Ref (not state) - read inside the poll's setInterval callback,
  // which closes over whatever `user` was at the time the interval was
  // created unless this is a ref; a ref always reads the latest value.
  const userRef = useRef(null);
  userRef.current = user;

  // The session lives in a cookie the browser already holds (if any) —
  // on load we just ask the server who that cookie belongs to. This is
  // what makes NavBar (and everything else) reflect login state without
  // each page having to fetch /me itself.
  //
  // cache: 'no-store' is explicit defense-in-depth on top of the
  // server's own Cache-Control: no-store (see app.py) - without either
  // one, a shared cache sitting in front of the API that doesn't itself
  // vary on the session cookie could serve one visitor's cached
  // /api/auth/me response to a completely different visitor, which from
  // here looks identical to "being logged into someone else's account."
  useEffect(() => {
    // Guarantees a csrf_token cookie exists before this tab ever sends
    // its first state-changing request (login, signup, etc.) - see
    // get_csrf_token()'s own docstring in app.py for why this specific
    // chicken-and-egg case needs a dedicated GET rather than relying on
    // some earlier response to have set the cookie as a side effect.
    // Fire-and-forget: doesn't block setLoading(false) below, and a
    // failure here just means the FIRST unsafe request this tab makes
    // will 403 and can be retried - not worth stalling the entire app on.
    fetch('/api/csrf-token', { credentials: 'include', cache: 'no-store' }).catch(() => {});

    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Re-verifies with the server RIGHT NOW whether the session is still
   * valid, rather than trusting whatever `user`/`isAuthenticated`
   * already holds in React state. This is what ProtectedRoute.jsx calls
   * on every navigation to a protected page - without this, a session
   * that expired between the last periodic poll (see
   * SESSION_CHECK_POLL_MS below - up to 5 minutes stale) and now would
   * leave `isAuthenticated` sitting on a stale `true`, letting
   * ProtectedRoute wave the person through to a page that then fails
   * silently instead of prompting them to log back in.
   *
   * Returns true if still authenticated, false otherwise. On an actual
   * expiry (not just "was never logged in"), also updates `user` to
   * null and returns the reason so the caller can decide whether to
   * show a "session expired" message - ProtectedRoute doesn't currently
   * distinguish (any false send the person to /login), but a caller
   * that wants the specific reason has it available.
   */
  async function checkSession() {
    const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }).catch(() => null);
    if (res === null) {
      // A network hiccup isn't the same as an actual expiry - don't log
      // anyone out over it, but also can't confirm they're still in,
      // so report false (ProtectedRoute treats this the same as "not
      // authenticated" - reasonable given there's nothing else to go on).
      return { authenticated: userRef.current !== null, reason: null };
    }
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      return { authenticated: true, reason: null };
    }

    const data = await res.json().catch(() => ({}));
    setUser(null);
    return { authenticated: false, reason: data.reason || null };
  }

  // Periodically re-checks /api/auth/me while logged in, purely to
  // catch an inactivity-expired session (see SESSION_CHECK_POLL_MS's
  // own comment above) even on a page that isn't otherwise making any
  // requests. Only actually calls the server while userRef.current is
  // set - no point polling for a visitor who was never logged in to
  // begin with.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!userRef.current) return;

      const { authenticated, reason } = await checkSession();
      if (!authenticated && reason === 'session_expired') {
        navigate('/login', { state: { sessionExpired: true }, replace: true });
      }
    }, SESSION_CHECK_POLL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** credential = the ID token string from Google's <GoogleLogin onSuccess>. */
  async function loginWithGoogle(credential) {
    const data = await postJson('/api/auth/google', { credential });
    setUser(data);
    return data;
  }

  async function loginWithPassword(email, password) {
    const data = await postJson('/api/auth/login', { email, password });
    setUser(data);
    return data;
  }

  /**
   * Server always creates ROLE_BASIC accounts here - see
   * server/models/user.py and docs/ACCESS_LEVELS.md. Does NOT log the
   * user in or set `user` - a fresh signup starts unverified (see
   * email_verified in models/user.py) and needs a code entered via
   * verifyEmail() below before any session exists. Resolves with
   * { id, email, needs_verification: true } - the caller (SignUp.jsx)
   * uses that to navigate to the verify-email screen, same pattern as
   * requestPasswordReset navigating to the reset-code screen.
   */
  async function signup(name, email, password) {
    return postJson('/api/auth/signup', { name, email, password });
  }

  /** Resolves with the user and logs them in - a correct code proves email ownership. */
  async function verifyEmail(email, code) {
    const data = await postJson('/api/auth/verify-email', { email, code });
    setUser(data);
    return data;
  }

  /** Invalidates the last code and sends a fresh one. Unlike password-reset's resend, this can tell the caller the account is already verified or doesn't exist - see that route's own docstring for why that's not an email-enumeration issue here. */
  async function resendVerification(email) {
    return postJson('/api/auth/resend-verification', { email });
  }

  /** Always resolves with a generic message, regardless of whether the email exists. Sends a 6-digit code. */
  async function requestPasswordReset(email) {
    return postJson('/api/auth/forgot-password', { email });
  }

  /** Invalidates the last code and sends a fresh one to the same email. Same generic-message shape. */
  async function resendPasswordResetCode(email) {
    return postJson('/api/auth/forgot-password/resend', { email });
  }

  /** Invalidates any outstanding code for this email - call when the user goes back to re-enter their email. */
  async function cancelPasswordReset(email) {
    return postJson('/api/auth/forgot-password/back', { email }).catch(() => {}); // best-effort, never blocks navigation
  }

  /** Resolves with the user and logs them in, since a correct code proves account ownership. */
  async function verifyPasswordResetCode(email, code) {
    const data = await postJson('/api/auth/forgot-password/verify', { email, code });
    setUser(data);
    return data;
  }

  /**
   * Legacy path: redeems a token from a reset link emailed before this
   * deploy (see ResetPassword.jsx and reset_password()'s docstring in
   * app.py). New reset requests never generate these links anymore -
   * this only exists so an already-sent email still works.
   */
  async function resetPassword(token, password) {
    const data = await postJson('/api/auth/reset-password', { token, password });
    setUser(data);
    return data;
  }

  async function logout() {
    await postJson('/api/auth/logout', {}).catch(() => {}); // clear local state either way
    setUser(null);
  }

  /** fields: { name?, current_password?, new_password? } - each is independent, see server/app.py. */
  async function updateAccount(fields) {
    const data = await postJson('/api/auth/update-profile', fields);
    setUser(data);
    return data;
  }

  /** file: a File/Blob from an <input type="file">. */
  async function updatePicture(file) {
    const formData = new FormData();
    formData.append('picture', file);
    const res = await csrfFetch('/api/auth/update-picture', {
      method: 'POST',
      body: formData, // no Content-Type header - the browser sets the multipart boundary itself
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.description || data.error || 'Failed to update picture');
    }
    setUser(data);
    return data;
  }

  async function deleteAccount() {
    const res = await csrfFetch('/api/auth/me', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.description || data.error || 'Failed to delete account');
    }
    setUser(null);
    return data;
  }

  const value = {
    user,
    loading,
    isAuthenticated: Boolean(user),
    checkSession,
    // Matches the backend's @roles_required("publisher", "admin") pattern
    // used on every route this flag gates client-side (uploading
    // documents/reports, the globe-data workbook upload) - admin can do
    // everything publisher can, so this has to be true for both roles,
    // not just a literal role === 'publisher' check.
    isPublisher: user?.role === 'publisher' || user?.role === 'admin',
    isAdmin: user?.role === 'admin',
    loginWithGoogle,
    loginWithPassword,
    signup,
    verifyEmail,
    resendVerification,
    requestPasswordReset,
    resendPasswordResetCode,
    cancelPasswordReset,
    verifyPasswordResetCode,
    resetPassword,
    updateAccount,
    updatePicture,
    deleteAccount,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}