import React, { Suspense, lazy } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import Footer from './components/Footer.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RouteLoading from './components/RouteLoading.jsx';
import Home from './pages/Home.jsx';

// Every other page is lazy-loaded (a separate JS chunk Vite only
// fetches when someone actually navigates there) instead of bundled
// into the one file every visitor downloads up front - this app had
// zero code-splitting before, so loading the homepage meant paying for
// the Observatory's data-explorer/d3/recharts code, the Stripe
// checkout flow, the DOCX/PDF report viewer, every admin panel, etc.,
// none of which the average visitor ever touches. Home stays eager
// since it's what most visitors land on first and shouldn't show a
// loading flash; everything else trades a brief one-time fetch (see
// RouteLoading.jsx) for a smaller initial bundle for everyone.
const About = lazy(() => import('./pages/About.jsx'));
const Observatory = lazy(() => import('./pages/Observatory.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const ReportView = lazy(() => import('./pages/ReportView.jsx'));
const CountryProfiles = lazy(() => import('./pages/CountryProfiles.jsx'));
const Fellowship = lazy(() => import('./pages/Fellowship.jsx'));
const Certifications = lazy(() => import('./pages/Certifications.jsx'));
const Contact = lazy(() => import('./pages/Contact.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Signup = lazy(() => import('./pages/SignUp.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const VerifyResetCode = lazy(() => import('./pages/VerifyResetCode.jsx'));
const Unavailable = lazy(() => import('./pages/Unavailable.jsx'));
const Publish = lazy(() => import('./pages/Publish.jsx'));
const ReportPublish = lazy(() => import('./pages/ReportPublish.jsx'));
const PublishGlobeData = lazy(() => import('./pages/PublishGlobeData.jsx'));
const Docs = lazy(() => import('./pages/Docs.jsx'));
const Donate = lazy(() => import('./pages/Donate.jsx'));
const DonateThankYou = lazy(() => import('./pages/DonateThankYou.jsx'));
const CertificationEnrollThankYou = lazy(() => import('./pages/CertificationEnrollThankYou.jsx'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const PeerReview = lazy(() => import('./pages/PeerReview.jsx'));
const PeerReviewMine = lazy(() => import('./pages/PeerReviewMine.jsx'));

/**
 * Gives routed page content a gentle fade-in on navigation instead of
 * a hard cut. Keyed by pathname so React fully remounts (and
 * re-triggers the CSS entrance animation) on every route change -
 * NavBar/Footer are outside this wrapper and stay put.
 *
 * flex:1 + min-height:0 + display:flex/column here matter: #app is a
 * column flex container, and several pages (e.g. PlaceholderPage) rely
 * on being a direct flex child with flex:1 to center their content -
 * this wrapper has to pass that through transparently rather than
 * just being a plain block div.
 */
function PageTransition({ children }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  );
}

export default function App() {
  return (
    <div id="app">
      <ScrollToTop />
      <NavBar />
      <PageTransition>
        <Suspense fallback={<RouteLoading />}>
        <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/observatory" element={<Observatory />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/country-profiles" element={<CountryProfiles />} />
        <Route path="/fellows" element={<Fellowship />} />
        <Route path="/certifications" element={<Certifications />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/donate" element={<Donate />} />
        <Route path="/donate/thank-you" element={<DonateThankYou />} />
        <Route path="/certifications/enroll/thank-you" element={<CertificationEnrollThankYou />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />

        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/verify" element={<VerifyResetCode />} />
        {/* Kept for any reset link already emailed before this deploy
            (1-hour TTL) - see reset_password()'s docstring in app.py.
            New requests go through /forgot-password -> /reset-password/verify. */}
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/unavailable" element={<Unavailable />} />

        <Route
          path="/publish"
          element={
            <ProtectedRoute requireRole="publisher">
              <Publish />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        {/* Not wrapped in ProtectedRoute - PeerReview.jsx does its own
            auth/publisher-access check via PublisherAccessGate, same
            reasoning as /reports/publish above. */}
        <Route path="/peer-review" element={<PeerReview />} />
        <Route path="/peer-review/mine" element={<PeerReviewMine />} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        {/* Not wrapped in ProtectedRoute on purpose - see the comment atop
            PublishGlobeData.jsx: it does its own auth/role check so a
            non-publisher/admin landing here sees an explanation instead
            of a silent redirect. Server-side enforcement is the real
            gate (@roles_required("publisher", "admin") on
            POST /api/globe-data/upload). */}
        <Route path="/publish/globe-data" element={<PublishGlobeData />} />
        {/* Also not wrapped in ProtectedRoute, for the same reason - see
            the comment atop ReportPublish.jsx. Linked from the "Publish
            a Report" section of /reports. */}
        <Route path="/reports/publish" element={<ReportPublish />} />
        {/* A real page (not a same-page modal) so a specific report has
            its own shareable/bookmarkable URL and works with the
            browser back button - see the comment atop ReportView.jsx.
            Not wrapped in ProtectedRoute: a published report is public,
            and ReportView.jsx's own fetch of GET /api/reports/:id
            already 404s cleanly for a report that isn't visible to the
            current viewer (see _can_view_report in app.py) - the same
            server-side gate every other report route already relies on. */}
        <Route path="/reports/:id" element={<ReportView />} />
      </Routes>
      </Suspense>
      </PageTransition>
      <Footer />
    </div>
  );
}