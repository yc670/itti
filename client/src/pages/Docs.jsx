import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import {
  GTBI_SOURCES, GTBI_FORMULA_NOTES, GTBI_KNOWN_GAP, GTBI_INTERPRETATION_SHORT, GTBI_PANEL_SUMMARY,
  ETTI_METHODOLOGY_NOTES, ETTI_KNOWN_GAP, ETTI_INTERPRETATION_SHORT, ETTI_PANEL_SUMMARY,
  ETTI_FORMULA, ETTI_FORMULA_VARIABLES, ETTI_FORMULA_NOTE,
  UNDERLYING_EVENT_SOURCE,
  NTO_MAP_AUTHOR, NTO_MAP_PUBLISHED_DATE, NTO_MAP_CAPTION, NTO_MAP_REFERENCES, NTO_MAP_FORMATTING_NOTES,
  USER_GUIDE_INTRO, USER_GUIDE_STEPS,
} from '../data/observatoryReferences.js';
import SEO from '../components/SEO.jsx';
import '../styles/About.css';
import '../styles/Docs.css';

// Shared with About.jsx: this site's html/body sizing makes <body> the
// actual scrolling container rather than the window.
function getScroller() {
  const candidate = document.scrollingElement;
  if (candidate && candidate.scrollHeight > candidate.clientHeight) return candidate;
  return document.body;
}

const SECTIONS = [
  { id: 'user-guide', label: 'User Guide' },
  { id: 'overview', label: 'Overview' },
  { id: 'etti', label: 'ETTI' },
  { id: 'gtbi', label: 'GTBI' },
  { id: 'gtbi-sources', label: 'GTBI Sources' },
  { id: 'nto-map', label: 'NTO Map' },
  { id: 'conventions', label: 'Data Conventions' }
];

export default function Docs() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const sectionRefs = useRef({});
  const { hash } = useLocation();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-12% 0px -55% 0px', threshold: 0 }
    );

    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));

    const scroller = getScroller();
    function onScroll() {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        setActiveSection(SECTIONS[SECTIONS.length - 1].id);
      }
    }
    scroller.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  function registerSection(id) {
    return (el) => {
      sectionRefs.current[id] = el;
    };
  }

  function scrollToSection(id) {
    const el = sectionRefs.current[id];
    if (!el) return;
    const scroller = getScroller();
    const navbarHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')) || 0;
    const top = el.getBoundingClientRect().top + scroller.scrollTop - navbarHeight - 16;
    scroller.scrollTo({ top, behavior: 'smooth' });
  }

  // Supports deep links like /docs#user-guide or /docs#nto-map (used by
  // the Observatory page) - refs are populated synchronously during
  // render, so they're ready by the time this effect runs on mount.
  useEffect(() => {
    if (!hash) return;
    scrollToSection(hash.slice(1));
  }, [hash]);

  return (
    <div className="about-page">
      <SEO
        path="/docs"
        title="Documentation & References"
        description="Data sources, methodology, and how to interpret the ITTI Observatory's ETTI and GTBI figures."
      />
      <Reveal delay={0}>
      <section className="about-hero">
        <p className="about-hero-eyebrow mono">ITTI Observatory</p>
        <h1 className="about-hero-title display">Documentation &amp; References</h1>
        <p className="about-hero-tagline">
          Data sources, methodology, and how to interpret the Observatory's ETTI and GTBI figures.
        </p>
      </section>
      </Reveal>

      <div className="about-layout">
        <nav className="about-index" aria-label="Docs page sections">
          <p className="about-index-label mono">On this page</p>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  className={`about-index-item${activeSection === s.id ? ' active' : ''}`}
                  onClick={() => scrollToSection(s.id)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="about-content">
          <Reveal delay={0}>
          <section id="user-guide" ref={registerSection('user-guide')} className="about-section">
            <h2 className="about-section-title display">How to Use the Observatory</h2>
            <div className="docs-interpretation">{USER_GUIDE_INTRO}</div>
            <div className="docs-cards">
              {USER_GUIDE_STEPS.map((step) => (
                <div key={step.title} className="docs-card">
                  <h3>{step.title}</h3>
                  <p>
                    {step.body.map((seg, i) =>
                      seg.bold ? <strong key={i}>{seg.bold}</strong> : <span key={i}>{seg.text}</span>
                    )}
                  </p>
                  {step.bullets && (
                    <ul className="docs-card-bullets">
                      {step.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
          </Reveal>

          <Reveal delay={70}>
          <section id="overview" ref={registerSection('overview')} className="about-section">
            <h2 className="about-section-title display">Shared Data Source</h2>
            <p>{UNDERLYING_EVENT_SOURCE}</p>
          </section>
          </Reveal>

          <Reveal delay={140}>
          <section id="etti" ref={registerSection('etti')} className="about-section">
            <h2 className="about-section-title display">ETTI — Election Trauma Temperature Index</h2>
            <div className="docs-interpretation">{ETTI_INTERPRETATION_SHORT}</div>
            <p>{ETTI_PANEL_SUMMARY}</p>
            <div className="docs-known-gap">{ETTI_KNOWN_GAP}</div>
            <div className="docs-cards">
              {ETTI_METHODOLOGY_NOTES.map((item) => (
                <div key={item.variable} className="docs-card">
                  <h3>{item.variable}</h3>
                  <p>{item.note}</p>
                  {item.formula && (
                    <div className="docs-formula-block">
                      <code className="docs-formula-eq">{item.formula}</code>
                      {item.formulaVariables?.length > 0 && (
                        <ul className="docs-formula-vars">
                          {item.formulaVariables.map((v) => (
                            <li key={v.symbol}><code>{v.symbol}</code> — {v.meaning}</li>
                          ))}
                        </ul>
                      )}
                      {item.formulaNote && <p className="docs-formula-note">{item.formulaNote}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <h3 className="about-subsection-title display">ETTI Composite Formula</h3>
            <div className="docs-formula-block docs-formula-block--final">
              <code className="docs-formula-eq">{ETTI_FORMULA}</code>
              <ul className="docs-formula-vars">
                {ETTI_FORMULA_VARIABLES.map((v) => (
                  <li key={v.symbol}><code>{v.symbol}</code> — {v.meaning}</li>
                ))}
              </ul>
              <p className="docs-formula-note">{ETTI_FORMULA_NOTE}</p>
            </div>
          </section>
          </Reveal>

          <Reveal delay={210}>
          <section id="gtbi" ref={registerSection('gtbi')} className="about-section">
            <h2 className="about-section-title display">GTBI — Global Trauma Burden Index</h2>
            <div className="docs-interpretation">{GTBI_INTERPRETATION_SHORT}</div>
            <p>{GTBI_PANEL_SUMMARY}</p>
            <div className="docs-known-gap">{GTBI_KNOWN_GAP}</div>

            <h3 className="about-subsection-title display">Formula</h3>
            <ul className="docs-formula-list">
              {GTBI_FORMULA_NOTES.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </section>
          </Reveal>

          <Reveal delay={280}>
          <section id="gtbi-sources" ref={registerSection('gtbi-sources')} className="about-section">
            <h2 className="about-section-title display">GTBI Sources</h2>
            <div className="docs-sources-table-wrap">
              <table className="docs-sources-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Citation</th>
                    <th>Used for</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {GTBI_SOURCES.map((s) => (
                    <tr key={s.id}>
                      <td className="docs-source-id">{s.id}</td>
                      <td>{s.citation}</td>
                      <td>{s.usedFor}</td>
                      <td>{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </Reveal>

          <Reveal delay={350}>
          <section id="nto-map" ref={registerSection('nto-map')} className="about-section">
            <h2 className="about-section-title display">NTO — Nigeria Geographic Stressor Severity Map</h2>
            <div className="docs-interpretation">{NTO_MAP_CAPTION}</div>
            <p>Map by {NTO_MAP_AUTHOR}. Published {NTO_MAP_PUBLISHED_DATE}.</p>

            <h3 className="about-subsection-title display">References</h3>
            <div className="docs-sources-table-wrap">
              <table className="docs-sources-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Citation</th>
                  </tr>
                </thead>
                <tbody>
                  {NTO_MAP_REFERENCES.map((r) => (
                    <tr key={r.id}>
                      <td className="docs-source-id">{r.id}</td>
                      <td>{r.citation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="docs-known-gap">{NTO_MAP_FORMATTING_NOTES}</div>
          </section>
          </Reveal>

          <Reveal delay={420}>
          <section id="conventions" ref={registerSection('conventions')} className="about-section">
            <h2 className="about-section-title display">Missing-Value Convention</h2>
            <p>
              Any variable without a usable number is recorded as <code>"Data Pending"</code> rather than a null or a
              numeric placeholder like <code>-1</code>, so it's never mistaken for a real value in a chart or export.
              A country with no recorded years at all for an indicator still has that indicator's section present, with
              a single <code>"Data Pending"</code> year.
            </p>
          </section>
          </Reveal>
        </div>
      </div>
    </div>
  );
}