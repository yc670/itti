import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuth } from '../context/AuthContext.jsx';
import { csrfFetch } from '../api.js';
import { checkEmail, checkName, checkDonationAmount } from '../utils/formValidation.js';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/Donate.css';

const FALLBACK_PRESETS_CENTS = [2500, 5000, 10000, 25000]; // used only if /api/donations/config can't be reached

function centsToDollarLabel(cents) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Mounted only once a PaymentIntent's client_secret exists (see Donate,
 * below), inside <Elements> - useStripe/useElements only work in that
 * context. This is where the actual payment method entry and the actual
 * charge happen: Stripe's own <PaymentElement> collects card/bank/wallet
 * details (never touching this app's code or servers), and
 * confirmPayment() is the API call that submits the real transaction.
 */
function DonationPaymentForm({ amountDollars, confirmationCode }) {
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
        return_url: `${window.location.origin}/donate/thank-you`,
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
    <form className="donate-card" onSubmit={handlePay}>
      {error && <p className="donate-error">{error}</p>}
      <p className="donate-payment-amount">
        Donating <strong>${amountDollars.toFixed(2)}</strong>
        <span className="donate-payment-confirmation"> · Confirmation {confirmationCode}</span>
      </p>
      <PaymentElement />
      <button type="submit" className="donate-submit-button" disabled={!stripe || submitting}>
        {submitting ? 'Processing…' : `Donate $${amountDollars.toFixed(2)}`}
      </button>
      <p className="donate-stripe-note">
        Payments are processed securely by Stripe. Card, bank, and wallet options (e.g. Apple Pay, Cash App
        Pay, Link) are offered automatically based on your device and location — ITTI never sees or stores
        your payment details.
      </p>
    </form>
  );
}

export default function Donate() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const wasCanceled = searchParams.get('canceled') === '1';

  const [presetsCents, setPresetsCents] = useState(FALLBACK_PRESETS_CENTS);
  const [publishableKey, setPublishableKey] = useState(null);
  const [configError, setConfigError] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState(null);
  const [customAmount, setCustomAmount] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Step 2 state: once a PaymentIntent exists, the amount/details are
  // locked in and the embedded payment form takes over.
  const [clientSecret, setClientSecret] = useState(null);
  const [confirmedAmountDollars, setConfirmedAmountDollars] = useState(null);
  const [confirmationCode, setConfirmationCode] = useState(null);

  // Prefill from the logged-in account, if any — donating doesn't require
  // an account, this is purely a convenience when one exists.
  useEffect(() => {
    if (!user) return;
    if (user.email && !email) setEmail(user.email);
    if (user.name && !firstName && !lastName) {
      const [first, ...rest] = user.name.trim().split(/\s+/);
      setFirstName(first || '');
      setLastName(rest.join(' '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    fetch('/api/donations/config')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data?.presets_cents?.length) setPresetsCents(data.presets_cents);
        setPublishableKey(data?.publishable_key || '');
      })
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

  function selectPreset(cents) {
    setSelectedPreset(cents);
    setCustomAmount('');
  }

  function handleCustomAmountChange(e) {
    setCustomAmount(e.target.value);
    setSelectedPreset(null);
  }

  const amountDollars = selectedPreset != null ? selectedPreset / 100 : parseFloat(customAmount);

  async function handleContinue(e) {
    e.preventDefault();
    setError(null);

    const validationError =
      checkName(firstName) ||
      checkName(lastName) ||
      checkEmail(email) ||
      checkDonationAmount(amountDollars);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const res = await csrfFetch('/api/donations/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          amount_cents: Math.round(amountDollars * 100),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.description || data.error || 'Something went wrong. Please try again.');
      }
      setClientSecret(data.client_secret);
      setConfirmationCode(data.confirmation_code);
      setConfirmedAmountDollars(amountDollars);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const showingPaymentStep = !!clientSecret && !!stripePromise;

  return (
    <div className="donate-page">
      <SEO
        path="/donate"
        title="Donate"
        description="Support the International Truth & Trauma Institute's work documenting and responding to election- and conflict-related trauma around the world. Donations are processed securely through Stripe."
      />
      <Reveal delay={0}>
        <div className="donate-hero">
          <p className="donate-hero-eyebrow mono">Support ITTI</p>
          <h1 className="donate-hero-title display">Make a Donation</h1>
          <p className="donate-hero-tagline">
            Your gift funds our work documenting and responding to election- and conflict-related trauma
            around the world. Every donation is processed securely through Stripe.
          </p>
        </div>
      </Reveal>

      {showingPaymentStep ? (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <DonationPaymentForm amountDollars={confirmedAmountDollars} confirmationCode={confirmationCode} />
        </Elements>
      ) : (
        <form className="donate-card" onSubmit={handleContinue}>
          {wasCanceled && (
            <p className="donate-notice">Your previous payment attempt didn't go through. You can try again below.</p>
          )}
          {configError && (
            <p className="donate-notice">
              We're having trouble reaching our payment processor right now. You can still fill out the form —
              try submitting in a moment.
            </p>
          )}
          {error && <p className="donate-error">{error}</p>}

          <Reveal delay={90}>
            <fieldset className="donate-fieldset">
              <legend>Choose an amount</legend>
              <div className="donate-amount-grid">
                {presetsCents.map((cents) => (
                  <button
                    key={cents}
                    type="button"
                    className={`donate-amount-chip${selectedPreset === cents ? ' active' : ''}`}
                    onClick={() => selectPreset(cents)}
                  >
                    {centsToDollarLabel(cents)}
                  </button>
                ))}
              </div>
              <label className="donate-field donate-custom-amount">
                <span>Custom amount (USD)</span>
                <div className="donate-custom-amount-input">
                  <span className="donate-currency-prefix">$</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="decimal"
                    placeholder="Other amount"
                    value={customAmount}
                    onChange={handleCustomAmountChange}
                  />
                </div>
              </label>
            </fieldset>
          </Reveal>

          <Reveal delay={170}>
            <fieldset className="donate-fieldset">
              <legend>Your information</legend>
              <div className="donate-name-row">
                <label className="donate-field">
                  <span>First name</span>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </label>
                <label className="donate-field">
                  <span>Last name</span>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </label>
              </div>
              <label className="donate-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <p className="donate-email-note">Your donation receipt and confirmation number will be sent here.</p>
            </fieldset>
          </Reveal>

          <Reveal delay={250}>
            <button type="submit" className="donate-submit-button" disabled={loading}>
              {loading ? 'Preparing payment…' : 'Continue to payment'}
            </button>
          </Reveal>
        </form>
      )}
    </div>
  );
}