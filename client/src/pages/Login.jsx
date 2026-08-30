import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../context/AuthContext.jsx";
import { checkEmail } from "../utils/formValidation.js";
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import Modal from '../components/Modal.jsx';
import "../styles/Login.css";

/**
 * Login page. Supports both Google Sign-In and email/password (for
 * accounts created via /signup) — previously only Google was wired up
 * here even though the backend has always supported both.
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithGoogle, loginWithPassword } = useAuth();
  const redirectTo = location.state?.from?.pathname || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Pre-populated (rather than null) when AuthContext.jsx's periodic
  // session-expiry check redirects here with state.sessionExpired -
  // this is what actually surfaces "why am I suddenly logged out" to
  // the person, rather than them just landing on an unexplained login
  // screen.
  const [error, setError] = useState(
    location.state?.sessionExpired ? "Your session expired due to inactivity. Please log in again." : null
  );
  const [loading, setLoading] = useState(false);
  // Set (to the pending redirect target) when the backend reports this
  // Google sign-in was linked to a pre-existing email/password account
  // (see linked_existing_account in /api/auth/google's response) -
  // holds navigation until the user acknowledges the popup, so the
  // message isn't missed in the middle of a redirect.
  const [linkedAccountRedirect, setLinkedAccountRedirect] = useState(null);

  async function handleGoogleSuccess(credentialResponse) {
    setError(null);
    setLoading(true);
    try {
      const data = await loginWithGoogle(credentialResponse.credential);
      if (data.linked_existing_account) {
        setLinkedAccountRedirect(redirectTo);
      } else {
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLinkedAccountAcknowledge() {
    const target = linkedAccountRedirect || "/";
    setLinkedAccountRedirect(null);
    navigate(target, { replace: true });
  }

  function handleGoogleError() {
    setError("Google sign-in was cancelled or failed. Please try again.");
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError(null);

    // Deliberately limited to format/presence only - this must never
    // narrow down further than the server's own generic "Invalid email
    // or password" response does, or it would leak which field was
    // actually wrong before a single request is even sent.
    const emailFormatError = checkEmail(email);
    if (emailFormatError) {
      setError(emailFormatError);
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    try {
      await loginWithPassword(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // err.data is attached by postJson() in AuthContext.jsx whenever
      // the server response body has more than error/description - here
      // that's the account's email, so the verify-email screen can be
      // pre-filled with it rather than asking the person to retype what
      // they just typed into this form a second ago.
      if (err.data?.error === 'email_not_verified') {
        navigate('/verify-email', { state: { email: err.data.email }, replace: true });
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <SEO
        path="/login"
        title="Log In"
        description="Sign in to your International Truth & Trauma Institute account."
        noindex
      />
      <Reveal delay={0}>
      <div className="login-card">
        <h1>Sign in</h1>

        {error && <p className="login-error">{error}</p>}
        {loading && <p className="login-status">Signing you in…</p>}

        <div className="login-google">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            useOneTap={false}
          />
        </div>

        <div className="login-divider">
          <span>or</span>
        </div>

        <form className="login-password-form" onSubmit={handlePasswordSubmit}>
          <label className="login-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <p className="login-forgot-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
          <button type="submit" className="login-submit-button" disabled={loading}>
            Log in
          </button>
        </form>

        <p className="login-signup-link">
          Don&rsquo;t have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
      </Reveal>

      {linkedAccountRedirect !== null && (
        <Modal
          title="Account updated"
          onClose={handleLinkedAccountAcknowledge}
          footer={
            <button
              type="button"
              className="app-modal-btn app-modal-btn--primary"
              onClick={handleLinkedAccountAcknowledge}
            >
              Continue
            </button>
          }
        >
          <p>
            An account already existed for this email, so we&rsquo;ve linked your Google
            sign-in to it. Your existing data hasn&rsquo;t been lost — you can now sign in
            either with Google or with your original password.
          </p>
        </Modal>
      )}
    </div>
  );
}