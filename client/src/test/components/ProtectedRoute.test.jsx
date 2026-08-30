import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

function renderProtected(authValue, initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthContext.Provider value={authValue}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('renders the protected content when checkSession confirms authentication', async () => {
    const authValue = {
      isAuthenticated: true,
      user: { role: 'basic' },
      loading: false,
      checkSession: vi.fn().mockResolvedValue({ authenticated: true, reason: null }),
    };

    renderProtected(authValue);

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());
    expect(authValue.checkSession).toHaveBeenCalled();
  });

  it('redirects to /login when checkSession finds the session has actually expired, even if isAuthenticated was still stale-true', async () => {
    const authValue = {
      isAuthenticated: true,
      user: { role: 'basic' },
      loading: false,
      checkSession: vi.fn().mockResolvedValue({ authenticated: false, reason: 'session_expired' }),
    };

    renderProtected(authValue);

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects to /login when never authenticated at all', async () => {
    const authValue = {
      isAuthenticated: false,
      user: null,
      loading: false,
      checkSession: vi.fn().mockResolvedValue({ authenticated: false, reason: null }),
    };

    renderProtected(authValue);

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('shows nothing while auth is still loading', () => {
    const authValue = {
      isAuthenticated: false,
      user: null,
      loading: true,
      checkSession: vi.fn().mockResolvedValue({ authenticated: false, reason: null }),
    };

    const { container } = renderProtected(authValue);
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects to home when the user lacks the required role', async () => {
    const authValue = {
      isAuthenticated: true,
      user: { role: 'basic' },
      loading: false,
      checkSession: vi.fn().mockResolvedValue({ authenticated: true, reason: null }),
    };

    render(
      <MemoryRouter initialEntries={['/publish']}>
        <AuthContext.Provider value={authValue}>
          <Routes>
            <Route
              path="/publish"
              element={
                <ProtectedRoute requireRole="publisher">
                  <div>Publish page</div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<div>Home page</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
  });

  it('admin satisfies any requireRole', async () => {
    const authValue = {
      isAuthenticated: true,
      user: { role: 'admin' },
      loading: false,
      checkSession: vi.fn().mockResolvedValue({ authenticated: true, reason: null }),
    };

    render(
      <MemoryRouter initialEntries={['/publish']}>
        <AuthContext.Provider value={authValue}>
          <Routes>
            <Route
              path="/publish"
              element={
                <ProtectedRoute requireRole="publisher">
                  <div>Publish page</div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<div>Home page</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Publish page')).toBeInTheDocument());
  });
});
