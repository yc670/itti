import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Login from '../../pages/Login.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

// GoogleLogin needs a GoogleOAuthProvider context this test doesn't set
// up (irrelevant to what's being tested here) - stub it out to a plain
// element instead of rendering the real button.
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: () => <div data-testid="google-login-stub" />,
}));

const mockAuthValue = {
  loginWithGoogle: vi.fn(),
  loginWithPassword: vi.fn(),
  user: null,
  isAuthenticated: false,
};

function renderLoginAt(routerState) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: routerState }]}>
        <AuthContext.Provider value={mockAuthValue}>
          <Routes>
            <Route path="/login" element={<Login />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('Login - session expiry message', () => {
  it('shows a session-expired notice when arriving via that navigation state', () => {
    renderLoginAt({ sessionExpired: true });
    expect(screen.getByText(/session expired due to inactivity/i)).toBeInTheDocument();
  });

  it('shows no error message on a normal visit to the login page', () => {
    renderLoginAt(undefined);
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });
});
