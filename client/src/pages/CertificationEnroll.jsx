import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import Modal from '../components/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { csrfFetch } from '../api.js';

// Kept in sync with server/app.py's REFUND_PARTIAL_WINDOW_DAYS /
// REFUND_PARTIAL_FRACTION - the server enforces this for real (see
// refund_enrollment), this is just the same policy shown before purchase
// so nobody pays without seeing it first.
const REFUND_POLICY_TEXT =
  'Enrollments canceled within 7 days of purchase are eligible for a 50% refund of tuition paid. ' +
  'No refunds are available after 7 days from the date of purchase.';

/**
 * Mounted only once a PaymentIntent's client_secret exists, inside
 * <Elements> - useStripe/useElements only work in that context. Mirrors
 * DonationPaymentForm in Donate.jsx: Stripe's own <PaymentElement>
 * collects card/bank/wallet details directly (never touching this app's
 * code or servers), and confirmPayment() submits the actual charge.
 */
function EnrollmentPaymentForm({ cert, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handlePay(e) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/certifications/enroll/thank-you`,
      },
    });

    // confirmPayment redirects the browser on success, so reaching this
    // line at all means it didn't - either a validation problem with the
    // payment details (card declined, etc.) or a network hiccup.
    if (confirmError) {
      setError(confirmError.message || 'Your payment could not be processed. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handlePay}>
      {error && <p className="app-modal-error" style={{ margin: '0 0 8px 0', padding: 0 }}>{error}</p>}
      <PaymentElement />
      <div className="app-modal-actions" style={{ padding: '16px 0 0 0', border: 'none', margin: 0 }}>
        <button type="button" className="app-modal-btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="app-modal-btn app-modal-btn--primary" disabled={!stripe || submitting}>
          {submitting ? 'Processing…' : `Pay ${cert.tuition}`}
        </button>
      </div>
    </form>
  );
}

/**
 * Pops up when "Enroll" is clicked on the Certifications page - shows the
 * cert, price, and refund policy together, then (once the person clicks
 * "Proceed to Payment") mounts Stripe's embedded Payment Element in the
 * same panel rather than redirecting away to a separate hosted page.
 * Requires login; if the person isn't signed in, sends them to /login
 * and back rather than showing the modal at all.
 *
 * cert: the certifications.js entry ({ code, name, tuition, ... })
 * onClose: called when the modal is dismissed without completing payment
 */
export default function CertificationEnrollModal({ cert, onClose }) {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [publishableKey, setPublishableKey] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [startError, setStartError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // Wait until we actually know whether they're signed in - redirecting
    // while auth is still resolving would bounce someone who IS logged in
    // but whose session check just hasn't come back yet.
    if (!authLoading && !isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/certifications' } } });
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    fetch('/api/certifications/config')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setPublishableKey(data?.publishable_key || ''))
      .catch(() => {
        setConfigError(true);
        setPublishableKey('');
      });
  }, []);

  // loadStripe() only needs to run once per key, not on every render.
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  if (authLoading || !isAuthenticated) {
    return null;
  }

  async function handleProceedToPayment() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await csrfFetch('/api/certifications/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cert_code: cert.code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStartError(data.description || 'Something went wrong starting checkout. Please try again.');
        setStarting(false);
        return;
      }
      setClientSecret(data.client_secret);
    } catch {
      setStartError('Something went wrong starting checkout. Please try again.');
      setStarting(false);
    }
  }

  const showingPaymentStep = !!clientSecret && !!stripePromise;

  return (
    <Modal
      title={`Enroll in ${cert.code}\u2122`}
      onClose={starting ? undefined : onClose}
      footer={
        showingPaymentStep
          ? null
          : (
            <>
              <button type="button" className="app-modal-btn" onClick={onClose} disabled={starting}>
                Cancel
              </button>
              <button
                type="button"
                className="app-modal-btn app-modal-btn--primary"
                onClick={handleProceedToPayment}
                disabled={starting}
              >
                {starting ? 'Preparing payment…' : `Proceed to Payment — ${cert.tuition}`}
              </button>
            </>
          )
      }
    >
      {showingPaymentStep ? (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <p style={{ color: 'var(--text-hi)', fontWeight: 600 }}>
            {cert.name} &mdash; {cert.tuition}
          </p>
          <EnrollmentPaymentForm cert={cert} onCancel={onClose} />
          <p style={{ fontSize: '12px', color: 'var(--text-low)', marginTop: '12px' }}>
            Payments are processed securely by Stripe. Card, bank, and wallet options are offered automatically
            based on your device and location — ITTI never sees or stores your payment details.
          </p>
        </Elements>
      ) : (
        <>
          <p style={{ color: 'var(--text-hi)', fontWeight: 600 }}>{cert.name}</p>
          <p>{cert.tagline}</p>
          <p style={{ color: 'var(--text-hi)' }}>Tuition: <strong>{cert.tuition}</strong></p>

          <h4>Refund Policy</h4>
          <p>{REFUND_POLICY_TEXT}</p>

          {configError && (
            <p className="app-modal-error" style={{ margin: '0 0 8px 0', padding: 0 }}>
              We're having trouble reaching our payment processor right now. You can still click "Proceed to
              Payment" — try again in a moment if it doesn't work.
            </p>
          )}
          {startError && <p className="app-modal-error" style={{ margin: '0 0 8px 0', padding: 0 }}>{startError}</p>}
        </>
      )}
    </Modal>
  );
}