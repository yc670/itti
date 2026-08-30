import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import SEO from '../components/SEO.jsx';
import '../styles/NotFound.css';

/**
 * Catch-all for any URL that doesn't match a route (App.jsx's final
 * <Route path="*">). Before this existed, an unmatched URL rendered a
 * blank page - <Routes> simply has nothing to show when no <Route>
 * matches, there's no implicit fallback.
 *
 * noindex via SEO (see that component) - a 404 page has no content
 * worth a search engine indexing, and indexing it risks it outranking
 * the real page someone meant to link to.
 */
export default function NotFound() {
  return (
    <div className="not-found-page">
      <SEO path="/404" title="Page Not Found" noindex />
      <Reveal delay={0}>
        <div className="not-found-content">
          <p className="not-found-eyebrow mono">404</p>
          <h1 className="not-found-title display">Page not found</h1>
          <p className="not-found-text">
            The page you're looking for doesn't exist, or may have moved.
          </p>
          <div className="not-found-actions">
            <Link to="/" className="btn btn-primary">
              Go to homepage
            </Link>
            <Link to="/reports" className="btn btn-secondary">
              Browse Reports
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
