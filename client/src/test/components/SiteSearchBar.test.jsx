import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SiteSearchBar from '../../components/SiteSearchBar.jsx';
import { siteSearch } from '../../utils/siteSearch.js';

// Mocks the whole search module rather than the network calls inside it -
// this test is about SiteSearchBar's own behavior (toggling, debouncing,
// rendering grouped results, click-through), not re-testing siteSearch()'s
// own logic (already covered separately, and by the backend's
// test_search.py for the reports portion specifically).
vi.mock('../../utils/siteSearch.js', () => ({
  siteSearch: vi.fn(),
}));

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SiteSearchBar', () => {
  it('is collapsed by default, showing only the toggle button', () => {
    renderWithRouter(<SiteSearchBar />);
    expect(screen.queryByPlaceholderText(/search reports/i)).not.toBeInTheDocument();
  });

  it('expands to show the input when the toggle is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SiteSearchBar />);

    await user.click(screen.getByRole('button', { name: /search the site/i }));

    expect(screen.getByPlaceholderText(/search reports/i)).toBeInTheDocument();
  });

  it('calls siteSearch after typing, debounced', async () => {
    siteSearch.mockResolvedValue({ pages: [], certifications: [], reports: [], fellows: [], countries: [] });
    const user = userEvent.setup();
    renderWithRouter(<SiteSearchBar />);

    await user.click(screen.getByRole('button', { name: /search the site/i }));
    await user.type(screen.getByPlaceholderText(/search reports/i), 'trauma');

    await waitFor(() => expect(siteSearch).toHaveBeenCalledWith('trauma', { limit: 4 }));
  });

  it('does not call siteSearch for a blank query', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SiteSearchBar />);

    await user.click(screen.getByRole('button', { name: /search the site/i }));
    await user.type(screen.getByPlaceholderText(/search reports/i), '   ');

    // Give the debounce window time to have fired if it was going to.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(siteSearch).not.toHaveBeenCalled();
  });

  it('renders grouped results once the search resolves', async () => {
    siteSearch.mockResolvedValue({
      pages: [{ title: 'Reports', description: 'Published research reports.', url: '/reports' }],
      certifications: [],
      reports: [],
      fellows: [],
      countries: [],
    });
    const user = userEvent.setup();
    renderWithRouter(<SiteSearchBar />);

    await user.click(screen.getByRole('button', { name: /search the site/i }));
    await user.type(screen.getByPlaceholderText(/search reports/i), 'reports');

    await waitFor(() => expect(screen.getByText('Reports')).toBeInTheDocument());
    expect(screen.getByText('Pages')).toBeInTheDocument(); // the group label
  });

  it('shows a "no results" message when every group is empty', async () => {
    siteSearch.mockResolvedValue({ pages: [], certifications: [], reports: [], fellows: [], countries: [] });
    const user = userEvent.setup();
    renderWithRouter(<SiteSearchBar />);

    await user.click(screen.getByRole('button', { name: /search the site/i }));
    await user.type(screen.getByPlaceholderText(/search reports/i), 'zzznomatch');

    await waitFor(() => expect(screen.getByText(/no results for/i)).toBeInTheDocument());
  });
});
