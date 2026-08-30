import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import "../styles/Login.css";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Second step of signup: the user enters the 6-digit code emailed by
 * /api/auth/signup (or re-sent from here). Reached two ways:
 *   - SignUp.jsx's navigate() right after signing up, with
 *     { state: { email } }
 *   - Login.jsx's navigate() when a login attempt returns
 *     email_not_verified (correct password, unverified account) - same
 *     { state: { email } } shape, pre-filled from the server's response
 *     rather than asking them to retype it.
 * If someone lands here directly with no email in location.state (e.g.
 * a refresh), send them to sign up rather than showing a broken form -
 * unlike VerifyResetCode.jsx, there's no natural "go back" page for
 * this one to return to, since arriving here doesn't imply they were
 * just on a specific prior form.
 *
 * On a correct code, the server marks the account verified AND logs
 * the user in immediately (see verify_email_route() in app.py) - entering
 * the code proves ownership, same reasoning as the password-reset flow.
 */
export default function VerifyEmail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyEmail, resendVerification } = useAuth();
  const email = location.state?.email || "";

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState(null);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef([]);

  if (!email) {
    return (
      <div className="login-page">
        <SEO path="/verify-email" title="Verify Email" noindex />
        <Reveal delay={0}>
        <div className="login-card">
          <h1>Verify your email</h1>
          <p className="login-error">
            This page needs to know which email to verify.
          </p>
          <p className="login-signup-link">
            <Link to="/signup">Back to sign up</Link>
          </p>
        </div>
        </Reveal>
      </div>
    );
  }

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const interval = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function handleDigitChange(index, rawValue) {
    const pasted = rawValue.replace(/\D/g, "");
    if (pasted.length > 1) {
      const next = Array(CODE_LENGTH).fill("");
      for (let i = 0; i < pasted.length && index + i < CODE_LENGTH; i++) {
        next[index + i] = pasted[i];
      }
      setDigits(next);
      const lastFilled = Math.min(index + pasted.length, CODE_LENGTH) - 1;
      inputRefs.current[lastFilled]?.focus();
      return;
    }

    const value = rawValue.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  const code = digits.join("");
  const codeComplete = code.length === CODE_LENGTH;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!codeComplete) {
      setError("Enter all 6 digits of the code.");
      return;
    }

    setLoading(true);
    try {
      await verifyEmail(email, code);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "That code doesn't match. Please check it and try again.");
      setDigits(Array(CODE_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResendStatus(null);
    setError(null);
    setResending(true);
    try {
      const data = await resendVerification(email);
      setResendStatus(data.message);
      setDigits(Array(CODE_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
      startCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="login-page">
      <SEO
        path="/verify-email"
        title="Verify Email"
        description="Enter the verification code sent to your email to activate your account."
        noindex
      />
      <Reveal delay={0}>
      <div className="login-card">
        <h1>Verify your email</h1>
        <p className="login-status">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to activate your
          account - it expires in 10 minutes.
        </p>

        {error && <p className="login-error">{error}</p>}
        {resendStatus && !error && <p className="login-status login-field-hint match">{resendStatus}</p>}

        <form className="login-password-form" onSubmit={handleSubmit}>
          <div className="code-input-row">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => (inputRefs.current[index] = el)}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={CODE_LENGTH}
                value={digit}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="code-input-box"
                aria-label={`Digit ${index + 1} of verification code`}
              />
            ))}
          </div>
          <button type="submit" className="login-submit-button" disabled={!codeComplete || loading}>
            {loading ? 'Verifying…' : 'Verify and activate account'}
          </button>
        </form>

        <p className="login-status login-resend-row">
          Didn&rsquo;t get a code?{' '}
          <button
            type="button"
            className="login-link-button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
          >
            {resending ? 'Sending…' : cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
        </p>
      </div>
      </Reveal>
    </div>
  );
}
