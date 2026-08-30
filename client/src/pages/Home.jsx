import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as topojson from 'topojson-client';
import Globe from '../components/Globe.jsx';
import Reveal from '../components/Reveal.jsx';
import SearchBar from '../components/SearchBar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import UnavailableMessage from '../components/UnavailableMessage.jsx';
import useHashScroll from '../hooks/useHashScroll.js';
import SEO from '../components/SEO.jsx';
import { fetchWorldData, fetchCountry, fetchAllCountries } from '../api.js';
import { computeCountryDataStatus, computeCountryQuickStats } from '../utils/countryDataStatus.js';

const EXPLORE_CARDS = [
  {
    to: '/observatory',
    label: 'Observatory',
    description: 'Documented trauma exposure across countries and regions, tracked through GTBI and ETTI.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <ellipse cx="24" cy="24" rx="17" ry="7" />
        <ellipse cx="24" cy="24" rx="17" ry="12.5" />
        <line x1="7" y1="24" x2="41" y2="24" />
        <line x1="24" y1="7" x2="24" y2="41" />
      </svg>
    )
  },
  {
    to: '/reports',
    label: 'Reports',
    description: 'Published briefs, PDFs, and other work coming out of the institute.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M13 6h16l7 7v29a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        <path d="M29 6v7h7" />
        <line x1="16" y1="22" x2="32" y2="22" />
        <line x1="16" y1="28" x2="32" y2="28" />
        <line x1="16" y1="34" x2="26" y2="34" />
      </svg>
    )
  },
  {
    to: '/about',
    label: 'About',
    description: 'Our mission, leadership, and how the organization is governed.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <line x1="16" y1="18" x2="16" y2="30" />
        <line x1="24" y1="18" x2="24" y2="30" />
        <line x1="32" y1="18" x2="32" y2="30" />
        <line x1="13" y1="32" x2="35" y2="32" />
      </svg>
    )
  },
  {
    to: '/fellows',
    label: 'Fellowship',
    description: 'A global fellowship developing leadership for trauma-informed governance and institutional recovery.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M24 10v28" />
        <path d="M24 14c-3 2-8 2-10 6 2 3 7 3 10 1" />
        <path d="M24 20c-3 2-8 2-10 6 2 3 7 3 10 1" />
        <path d="M24 26c-3 2-8 2-10 6 2 3 7 3 10 1" />
        <path d="M24 14c3 2 8 2 10 6-2 3-7 3-10 1" />
        <path d="M24 20c3 2 8 2 10 6-2 3-7 3-10 1" />
        <path d="M24 26c3 2 8 2 10 6-2 3-7 3-10 1" />
      </svg>
    )
  }
];

const MISSION_MESSAGE =
  'ITTI is a global research and advisory institute that documents collective trauma, builds ' +
  'country-level Trauma Observatories and standardized indices like the Global Trauma Burden ' +
  'Index (GTBI) and Election Trauma Temperature Index (ETTI), and turns those insights into ' +
  'trauma-informed governance and policy reform.';

export default function Home() {
  useHashScroll();
  const [worldData, setWorldData] = useState(null);
  const [worldDataError, setWorldDataError] = useState(false);
  const [features, setFeatures] = useState([]);
  const [country, setCountry] = useState(null); // { name, iso }
  const [metrics, setMetrics] = useState(null);
  const [countryStatus, setCountryStatus] = useState({}); // iso -> 'etti' | 'gtbi' | 'both'
  const [countryQuickStats, setCountryQuickStats] = useState({}); // iso -> { name, etti, gtbi } for the hover tooltip
  const globeRef = useRef(null);

  // Bumped on every retry click to re-trigger the effect below; the
  // value itself is never read, it just needs to change.
  const [retryCount, setRetryCount] = useState(0);

  function loadWorldData() {
    setWorldDataError(false);
    fetchWorldData()
      .then((world) => {
        setWorldData(world);
        const parsed = topojson.feature(world, world.objects.countries);
        setFeatures(parsed.features);
      })
      .catch(() => {
        // Previously had no .catch() at all - a failed/slow request left
        // worldData permanently null with no feedback, so the globe's
        // spot on the page just stayed blank forever with nothing to
        // tell the person anything had gone wrong or way to retry.
        setWorldDataError(true);
      });
  }

  useEffect(() => {
    loadWorldData();
    fetchAllCountries()
      .then((countries) => {
        setCountryStatus(computeCountryDataStatus(countries));
        setCountryQuickStats(computeCountryQuickStats(countries));
      })
      .catch(() => {
        setCountryStatus({}); // globe still renders fine with default colors
        setCountryQuickStats({}); // hover tooltip just won't show ETTI/GTBI lines
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  function retryWorldData() {
    setRetryCount((n) => n + 1);
  }

  function openCountry(name, iso) {
    setCountry({ name, iso });
    fetchCountry(iso)
      .then(setMetrics)
      .catch(() => setMetrics(null)); // fall back to placeholder zeros in the panel
  }

  function handleCountryClick(name, iso) {
    openCountry(name, iso);
  }

  function handleSelectFeature(feature) {
    globeRef.current?.focusOnFeature(feature);
  }

  function handleClose() {
    setCountry(null);
    setMetrics(null);
  }

  return (
    <>
      <SEO
        path="/"
        title="Global Trauma Research & Trauma-Informed Governance"
        description="The International Truth & Trauma Institute documents collective trauma, builds country-level Trauma Observatories and standardized indices like GTBI and ETTI, and turns those insights into trauma-informed governance and policy reform."
      />
      <main>
        {/* Part 1: welcome */}
        <Reveal delay={0}>
          <section className="home-welcome" id="welcome">
            <svg className="home-welcome-watermark" viewBox="0 0 400 400" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="200" cy="200" r="160" strokeWidth="1" />
              <ellipse cx="200" cy="200" rx="160" ry="62" strokeWidth="1" />
              <ellipse cx="200" cy="200" rx="160" ry="112" strokeWidth="1" />
              <line x1="40" y1="200" x2="360" y2="200" strokeWidth="1" />
              <line x1="200" y1="40" x2="200" y2="360" strokeWidth="1" />
            </svg>
            <p className="home-welcome-eyebrow">WELCOME</p>
            <h1 className="home-welcome-title display">
              Welcome <br />to the <br />International Truth &amp; Trauma Institute
            </h1>
            <p className="home-welcome-message">{MISSION_MESSAGE}</p>
          </section>
        </Reveal>

        {/* Part 2: globe (left) + message and country panel (right) */}
        <Reveal delay={120}>
          <section className="home-globe" id="globe">
            <div className="home-globe-grid">
              <div className="home-globe-left">
                <SearchBar features={features} onSelectFeature={handleSelectFeature} />
                {worldData && (
                  <Globe
                    ref={globeRef}
                    worldData={worldData}
                    onCountryClick={handleCountryClick}
                    countryStatus={countryStatus}
                    countryQuickStats={countryQuickStats}
                  />
                )}
                {!worldData && worldDataError && (
                  <div className="home-globe-error">
                    <UnavailableMessage variant="inline" />
                    <button type="button" className="home-globe-retry-btn" onClick={retryWorldData}>
                      Try again
                    </button>
                  </div>
                )}
                {!worldData && !worldDataError && (
                  <div className="home-globe-loading" aria-live="polite">Loading the globe…</div>
                )}
                <div className="globe-legend">
                  <span className="globe-legend-item">
                    <span className="globe-legend-swatch data-etti"></span>ETTI data
                  </span>
                  <span className="globe-legend-item">
                    <span className="globe-legend-swatch data-gtbi"></span>GTBI data
                  </span>
                  <span className="globe-legend-item">
                    <span className="globe-legend-swatch data-both"></span>ETTI + GTBI
                  </span>
                </div>
                <div className="hint">
                  <span className="dot"></span>DRAG TO ROTATE<span className="dot"></span>SCROLL TO ZOOM
                  <span className="dot"></span>CLICK A COUNTRY
                </div>
              </div>

              <div className="home-globe-right">
                <SidePanel country={country} record={metrics} onClose={handleClose} />
              </div>
            </div>
          </section>
        </Reveal>
      </main>

      <section className="home-explore" id="explore">
        <Reveal delay={0}>
          <div className="home-explore-intro">
            <p className="home-explore-eyebrow mono">EXPLORE</p>
            <h2 className="home-explore-heading display">Where to go from here</h2>
          </div>
        </Reveal>

        <div className="home-explore-grid">
          {EXPLORE_CARDS.map((card, i) => (
            <Reveal key={card.to} delay={i * 90}>
              <Link to={card.to} className="home-explore-card">
                <span className="home-explore-card-icon" aria-hidden="true">{card.icon}</span>
                <span className="home-explore-card-label display">{card.label}</span>
                <p className="home-explore-card-desc">{card.description}</p>
                <span className="home-explore-card-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-connect" id="connect">
        <Reveal delay={0}>
          <div className="home-connect-intro">
            <p className="home-explore-eyebrow mono">CONNECT</p>
            <h2 className="home-explore-heading display">Watch, follow, and learn more</h2>
          </div>
        </Reveal>

        <div className="home-connect-grid">
          <Reveal delay={90}>
            <a
              className="home-connect-card home-connect-card--video"
              href="https://youtube.com/shorts/XLbzQiiqUXU?si=IkReWAJ-HWrFvdzU"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="home-connect-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
                  <path d="M10.5 9.5v5l4.3-2.5-4.3-2.5Z" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span className="home-explore-card-label display">ITTI on YouTube</span>
              <p className="home-explore-card-desc">
                Watch a short introduction to the Institute's work on our YouTube channel.
              </p>
              <span className="home-explore-card-arrow" aria-hidden="true">&rarr;</span>
            </a>
          </Reveal>

          <Reveal delay={160}>
            <a
              className="home-connect-card"
              href="https://ofhusa.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="home-connect-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.7 3.8 6 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6-3.8-9S9.5 5.7 12 3Z" />
                </svg>
              </span>
              <span className="home-explore-card-label display">Outlets for Hope, Inc.</span>
              <p className="home-explore-card-desc">
                ITTI is a global research division of Outlets for Hope, Inc. Visit the parent organization's site.
              </p>
              <span className="home-explore-card-arrow" aria-hidden="true">&rarr;</span>
            </a>
          </Reveal>

          <Reveal delay={230}>
            <a
              className="home-connect-card"
              href="https://www.facebook.com/profile.php?id=61592894404554"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="home-connect-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <path d="M14 8.5h-1.5c-1 0-1.5.5-1.5 1.5v2h3l-.4 3h-2.6v6.5" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="home-explore-card-label display">ITTI on Facebook</span>
              <p className="home-explore-card-desc">
                Follow the Institute's page for updates, events, and announcements.
              </p>
              <span className="home-explore-card-arrow" aria-hidden="true">&rarr;</span>
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}