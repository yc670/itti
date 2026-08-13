import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CountUp from './CountUp.jsx';
import {
  getAvailableYears,
  getYearRecord,
  getNumericValue,
  formatField
} from '../utils/countryData.js';

/** Formats a numeric score to 2 decimals, or passes through "Data Pending" as-is. */
function fmt(value) {
  const num = getNumericValue(value);
  return num === null ? formatField(value) : num.toFixed(2);
}

/** Renders a numeric field with a restrained count-up animation, or
 *  the plain "Data Pending" text when there's no real value. Keyed by
 *  country so a fresh CountUp mounts (and counts up from 0) every time
 *  a different country is clicked on the globe, while switching the
 *  year dropdown for the *same* country smoothly transitions between
 *  the two values instead of resetting to 0. */
function Score({ value, countryKey }) {
  const num = getNumericValue(value);
  if (num === null) return <>{formatField(value)}</>;
  return <CountUp key={countryKey} value={num} />;
}

/** A <select> of the real years available for one index, or a disabled
 *  "No data" placeholder when the country has none for that index. */
function YearSelect({ label, years, value, onChange }) {
  if (years.length === 0) {
    return (
      <div className="year-select-wrap">
        <span className="year-select-label">{label}</span>
        <select className="year-select" disabled>
          <option>No data</option>
        </select>
      </div>
    );
  }
  return (
    <div className="year-select-wrap">
      <span className="year-select-label">{label}</span>
      <select
        className="year-select"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {years.map((year) => (
          <option key={year} value={year}>{year}</option>
        ))}
      </select>
    </div>
  );
}

export default function SidePanel({ country, record, onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [gtbiYear, setGtbiYear] = useState(null);
  const [ettiYear, setEttiYear] = useState(null);

  // record is the raw /api/countries/<code> response: { name, ETTI: {...}, GTBI: {...} }.
  // Every field inside can be a real number/string or the literal "Data Pending" -
  // always resolve through getYearRecord/getNumericValue/formatField rather than
  // reading record.GTBI.gtbi directly.
  const gtbiYears = getAvailableYears(record?.GTBI);
  const ettiYears = getAvailableYears(record?.ETTI);

  // Reset to the overview tab whenever a new country is selected. (Picking
  // the default year is handled below, not here - see effectiveGtbiYear/
  // effectiveEttiYear.)
  useEffect(() => {
    setActiveTab('overview');
    setGtbiYear(null);
    setEttiYear(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country?.iso]);

  // Home.jsx sets `country` synchronously the instant a globe click
  // happens, but `record` (this country's actual GTBI/ETTI data) only
  // arrives once its async fetch resolves - a render or two later. If the
  // dropdown's default year were only ever set from an effect keyed on
  // country.iso, that effect would fire on the *first* render (before
  // `record` has loaded), lock in gtbiYear/ettiYear as null since
  // getAvailableYears(undefined) is [], and then never fire again once
  // country.iso stops changing - even after `record` shows up with real
  // years available. That's the "shows Data Pending until you touch the
  // year dropdown" bug. Instead, derive the year to actually use fresh on
  // every render: fall back to the latest available year whenever the
  // stored selection isn't valid for the *current* record, so it's always
  // correct regardless of fetch timing, with no race possible.
  const effectiveGtbiYear = gtbiYears.includes(gtbiYear) ? gtbiYear : gtbiYears[0] ?? null;
  const effectiveEttiYear = ettiYears.includes(ettiYear) ? ettiYear : ettiYears[0] ?? null;

  if (!country) {
    return (
      <aside id="side-panel">
        <div className="panel-placeholder">
          <svg className="panel-placeholder-icon" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="46" stroke="var(--line)" strokeWidth="1.5" />
            <ellipse cx="60" cy="60" rx="46" ry="18" stroke="var(--line)" strokeWidth="1.5" />
            <ellipse cx="60" cy="60" rx="46" ry="32" stroke="var(--line)" strokeWidth="1.5" />
            <line x1="14" y1="60" x2="106" y2="60" stroke="var(--line)" strokeWidth="1.5" />
            <line x1="60" y1="14" x2="60" y2="106" stroke="var(--line)" strokeWidth="1.5" />
            <circle className="panel-placeholder-pulse" cx="78" cy="46" r="4" fill="var(--cyan)" />
            <circle cx="78" cy="46" r="4" fill="var(--cyan)" opacity="0.9" />
            <circle cx="40" cy="70" r="2.5" fill="var(--gold)" opacity="0.85" />
          </svg>
          <p className="panel-placeholder-title">No country selected</p>
          <p>Click any country on the globe to load its GTBI and ETTI profile here — scores, trends, and a year-by-year breakdown.</p>
          <div className="panel-placeholder-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 9V7a3 3 0 1 1 6 0v2" />
              <rect x="5" y="9" width="14" height="11" rx="2" />
              <path d="M12 13v3" />
            </svg>
            <span>Tip: drag to rotate, scroll to zoom, then tap a country</span>
          </div>
        </div>
      </aside>
    );
  }

  const name = country?.name || 'Select a country';
  const iso = country?.iso || '—';

  const gtbiOverview = getYearRecord(record?.GTBI, gtbiYears[0]) || {};
  const ettiOverview = getYearRecord(record?.ETTI, ettiYears[0]) || {};
  const gtbiSelected = getYearRecord(record?.GTBI, effectiveGtbiYear) || {};
  const ettiSelected = getYearRecord(record?.ETTI, effectiveEttiYear) || {};

  return (
    <aside id="side-panel">
      <div className="panel-top">
        <button className="panel-close" id="panel-close" aria-label="Clear selection" onClick={onClose}>
          ✕
        </button>
        <p className="country-eyebrow" id="country-code">{iso}</p>
        <h2 className="country-name" id="country-name">{name}</h2>
      </div>

      <div className="tabs">
        {['overview', 'gtbi', 'etti'].map((tab) => (
          <button
            key={tab}
            className={`tab-btn${activeTab === tab ? ' active' : ''}`}
            data-tab={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' ? 'Overview' : tab.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="panel-body">
        <div className={`tab-pane${activeTab === 'overview' ? ' active' : ''}`} id="tab-overview">
          <div className="score-card">
            <p className="score-label">Country</p>
            <div className="score-value small" id="ov-name" style={{ fontSize: 24, color: 'var(--text-hi)' }}>
              {name}
            </div>
            <p className="score-desc">
              This profile brings together two composite indices — the Global Trauma Burden Index (GTBI) and the
              Election Trauma Temperature Index (ETTI) — for a single country. Switch tabs above to explore each
              index, including every year we have data for.
            </p>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <div className="k">GTBI Score{gtbiYears[0] ? ` (${gtbiYears[0]})` : ''}</div>
              <div className="v" id="ov-gtbi"><Score value={gtbiOverview.gtbi} countryKey={iso} /></div>
            </div>
            <div className="metric">
              <div className="k">ETTI Score{ettiYears[0] ? ` (${ettiYears[0]})` : ''}</div>
              <div className="v" id="ov-etti"><Score value={ettiOverview.etti} countryKey={iso} /></div>
            </div>
          </div>
        </div>

        <div className={`tab-pane${activeTab === 'gtbi' ? ' active' : ''}`} id="tab-gtbi">
          <div className="score-card">
            <div className="score-card-head">
              <p className="score-label">GTBI — Global Trauma Burden Index</p>
              <YearSelect label="Year" years={gtbiYears} value={effectiveGtbiYear} onChange={setGtbiYear} />
            </div>
            <div className="score-value" id="gtbi-value"><Score value={gtbiSelected.gtbi} countryKey={iso} /></div>
            <p className="score-desc">
              A composite measure of a country's collective trauma burden, combining mortality (Years of Life Lost)
              and morbidity (Years Lived with Disability) from conflict-related harm.
            </p>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <div className="k">Trauma Level</div>
              <div className="v" id="m-trauma-level">{fmt(gtbiSelected.trauma_level)}</div>
              <div className="full">Categorical severity band</div>
            </div>
            <div className="metric">
              <div className="k">Burden Rate</div>
              <div className="v" id="m-burden-rate"><Score value={gtbiSelected.burden_rate} countryKey={iso} /></div>
              <div className="full">Per 100,000 population</div>
            </div>
            <div className="metric">
              <div className="k">YLL</div>
              <div className="v" id="m-yll"><Score value={gtbiSelected.yll} countryKey={iso} /></div>
              <div className="full">Years of Life Lost</div>
            </div>
            <div className="metric">
              <div className="k">YLD</div>
              <div className="v" id="m-yld"><Score value={gtbiSelected.yld} countryKey={iso} /></div>
              <div className="full">Years Lived with Disability</div>
            </div>
          </div>
        </div>

        <div className={`tab-pane${activeTab === 'etti' ? ' active' : ''}`} id="tab-etti">
          <div className="score-card">
            <div className="score-card-head">
              <p className="score-label">ETTI — Composite Score</p>
              <YearSelect label="Year" years={ettiYears} value={effectiveEttiYear} onChange={setEttiYear} />
            </div>
            <div className="score-value" id="etti-value"><Score value={ettiSelected.etti} countryKey={iso} /></div>
            <p className="score-desc">ETTI aggregates four underlying variables into a single composite score.</p>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <div className="k">EVS</div>
              <div className="v" id="m-evs"><Score value={ettiSelected.evs} countryKey={iso} /></div>
              <div className="full">Election Violence Severity</div>
            </div>
            <div className="metric">
              <div className="k">TIE</div>
              <div className="v" id="m-tie"><Score value={ettiSelected.tie} countryKey={iso} /></div>
              <div className="full">Trust in Electoral Institutions</div>
            </div>
            <div className="metric">
              <div className="k">PDL</div>
              <div className="v" id="m-pdl"><Score value={ettiSelected.pdl} countryKey={iso} /></div>
              <div className="full">Political Distrust Level</div>
            </div>
            <div className="metric">
              <div className="k">ITS</div>
              <div className="v" id="m-its"><Score value={ettiSelected.its} countryKey={iso} /></div>
              <div className="full">Institutional Trust Stability</div>
            </div>
          </div>
          <div className="placeholder-note">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <span>Fields showing "Data Pending" are awaiting source data and are not yet computable.</span>
          </div>
        </div>
      </div>

      <div className="panel-links">
        <Link className="panel-observatory-link" to="/observatory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          </svg>
          <span>Check out our observatory for more information</span>
        </Link>
        <Link className="panel-observatory-link" to={`/country-profiles?code=${encodeURIComponent(iso)}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span>View {name}'s full country profile</span>
        </Link>
      </div>
    </aside>
  );
}
