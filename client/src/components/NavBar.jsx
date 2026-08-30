import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import SiteSearchBar from './SiteSearchBar.jsx';

// How often to re-poll the unread notification count while signed in,
// so the glowing dot can appear without the user having to reload or
// navigate anywhere (e.g. a report they submitted gets approved while
// they're browsing another page). Cheap: unread-count is just a
// COUNT(*) query, not the full notification list.
const UNREAD_POLL_MS = 30000;

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/observatory', label: 'Observatory' },
  { to: '/reports', label: 'Reports' },
  { to: '/country-profiles', label: 'Country Profiles' },
  { to: '/fellows', label: 'Fellowship' },
  { to: '/certifications', label: 'Certifications' },
  { to: '/contact', label: 'Contact' },
  { to: '/donate', label: 'Donate', emphasize: true }
];

// Scroll distance (px) past the top before the logo hides. Must be > 0 and
// clearly separated from EXIT_SCROLL_PX below - see the hysteresis note in
// the scroll effect for why a single shared threshold flickers.
const ENTER_SCROLL_PX = 24;
// Scroll position at/under which the logo reappears. Kept at (near) the
// absolute top on purpose, per the intended behavior: the logo is only
// visible when the user is all the way back at the top of the page, not
// merely "close" to it. The small epsilon (rather than a strict 0) just
// absorbs sub-pixel scrollTop values some browsers report at rest (mobile
// Safari's elastic overscroll, fractional zoom levels, etc.).
const EXIT_SCROLL_PX = 2;

// This site's html/body sizing (see App.css) makes <body> the actual
// scrolling container rather than the window - same reason ScrollToTop.jsx
// and About.jsx's getScroller() don't use window.scrollTo/window.scrollY
// either. Listening on window here would never fire, since window itself
// never scrolls on this page.
function getScroller() {
  const candidate = document.scrollingElement;
  if (candidate && candidate.scrollHeight > candidate.clientHeight) return candidate;
  return document.body;
}

export default function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const navRef = useRef(null);

  // Drives the glowing dot on the user's avatar. `dotDismissed` tracks
  // whether the user has already clicked into their profile for the
  // current batch of unread notifications - it's reset (dot reappears)
  // the moment polling sees the unread count go *up* again, i.e. a
  // genuinely new notification arrived, rather than just re-fetching
  // the same count that was already dismissed.
  const [unreadCount, setUnreadCount] = useState(0);
  const [dotDismissed, setDotDismissed] = useState(false);
  const lastSeenUnreadRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      setDotDismissed(false);
      lastSeenUnreadRef.current = 0;
      return;
    }

    let cancelled = false;

    function poll() {
      fetch('/api/notifications/unread-count', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          const count = data.unread_count || 0;
          setUnreadCount(count);
          // A new notification arrived since we last saw a lower/equal
          // count - surface the dot again even if it was dismissed.
          if (count > lastSeenUnreadRef.current) setDotDismissed(false);
          lastSeenUnreadRef.current = count;
        })
        .catch(() => {});
    }

    poll();
    const interval = setInterval(poll, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const showNotificationDot = isAuthenticated && unreadCount > 0 && !dotDismissed;

  // The navbar's height changes on mobile (menu open/closed) and when the
  // logo collapses/expands on scroll, and it's sticky - so anything else on
  // the page that also needs to stick below it (e.g. the letter grid on
  // Country Profiles) reads this variable instead of a hardcoded pixel
  // offset.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    function updateHeight() {
      document.documentElement.style.setProperty('--navbar-height', `${el.offsetHeight}px`);
    }

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [menuOpen, isCompact]);

  // Collapse the logo once the user scrolls down, restore it once they're
  // back at the absolute top.
  //
  // This uses two different thresholds (enter vs. exit) rather than one
  // shared value on purpose. A single threshold - "compact past X, full
  // under X" - is unstable right at X: collapsing the logo shrinks the
  // navbar's height, which shifts page content up slightly, which can nudge
  // scrollY back under X, which re-expands the logo, which pushes content
  // back down past X again, and so on - a feedback loop that shows up as
  // the logo rapidly flickering on/off near the top of the page. Requiring
  // a bigger scroll distance to *enter* compact than to *exit* it (a dead
  // zone between EXIT_SCROLL_PX and ENTER_SCROLL_PX) means the navbar's own
  // height change can never by itself cross back over the threshold that
  // triggered it, so the two states can't chase each other.
  useEffect(() => {
    const scroller = getScroller();
    let ticking = false;

    function evaluateScroll() {
      ticking = false;
      const y = scroller.scrollTop || 0;
      setIsCompact((prevCompact) => {
        if (!prevCompact && y > ENTER_SCROLL_PX) return true;
        if (prevCompact && y <= EXIT_SCROLL_PX) return false;
        return prevCompact;
      });
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(evaluateScroll);
    }

    evaluateScroll(); // sync initial state, e.g. on reload mid-scroll
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  async function handleLogout() {
    await logout();
    setMenuOpen(false);
    navigate('/');
  }

  const links = NAV_LINKS;

  return (
    <nav className={`navbar${isCompact ? ' navbar-compact' : ''}`} ref={navRef}>
      <div className="navbar-top">
        <Link to="/" className="navbar-brand">
          <img src="/itti-logo.png" alt="ITTI seal" className="navbar-logo" />
          <span className="navbar-title display">International Truth &amp; Trauma Institute</span>
        </Link>

        <button
          className="navbar-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      {/* Links and auth share one row so Login/Sign up sit inline with the
          page links instead of in their own bar next to the logo - that
          also means this row (not the collapsing brand above) is what
          stays on screen once compact, so users still get every page and
          the login/signup buttons regardless of scroll position. */}
      <div className={`navbar-menu${menuOpen ? ' open' : ''}`}>
        <ul className="navbar-links">
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  'navbar-link' + (link.emphasize ? ' navbar-link-donate' : '') + (isActive ? ' active' : '')
                }
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <SiteSearchBar />

        <div className="navbar-auth">
          {isAuthenticated ? (
            <>
              <Link
                to="/profile"
                className="navbar-user"
                onClick={() => { setDotDismissed(true); setMenuOpen(false); }}
                aria-label={showNotificationDot ? `${user.name || user.email} (new notifications)` : user.name || user.email}
              >
                <span className="navbar-avatar-wrap">
                  <Avatar name={user.name} email={user.email} pictureUrl={user.picture_url} className="navbar-avatar" />
                  {showNotificationDot && <span className="navbar-notification-dot" aria-hidden="true" />}
                </span>
                <span className={`role-badge role-${user.role}`}>{user.role}</span>
              </Link>
              <button className="navbar-auth-btn" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="navbar-auth-btn">
                Log in
              </NavLink>
              <NavLink to="/signup" className="navbar-auth-btn primary">
                Sign up
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}