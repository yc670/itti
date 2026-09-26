import React from 'react';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/Events.css';

const FLYER_SRC = '/images/events/world-trauma-day-2026.png';

export default function Events() {
  return (
    <div className="events-page">
      <SEO
        path="/event"
        title="Events"
        description="Upcoming events from the International Truth & Trauma Institute (ITTI), including International World Trauma Day."
      />
      <Reveal delay={0}>
        <div className="events-intro">
          <p className="events-eyebrow mono">EVENTS</p>
          <h1 className="events-heading display">Upcoming Events</h1>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <a
          className="events-flyer-link"
          href={FLYER_SRC}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open flyer at full size in a new tab"
        >
          <img
            className="events-flyer-img"
            src={FLYER_SRC}
            alt="International World Trauma Day — Village Square. October 17, 2026, 11:00 AM EST, online event. Hosted by the International Truth & Trauma Institute (ITTI) and Outlets for Hope, Inc."
          />
        </a>
      </Reveal>
    </div>
  );
}
