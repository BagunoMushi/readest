import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridStateSnapshot, VirtuosoGridProps } from 'react-virtuoso';
import type { OPDSFeed, OPDSPublication } from '@/types/opds';
import { FeedView } from '@/app/opds/components/FeedView';

const grid = vi.hoisted(() => ({ props: {} as VirtuosoGridProps<unknown> }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: () => <div data-testid='cached-image' />,
}));

// jsdom has no layout, so the real Virtuoso renders nothing. Render every item
// synchronously via itemContent, matching the TOCView/BooknoteView test mocks.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  const renderAll = (
    {
      totalCount,
      itemContent,
    }: { totalCount: number; itemContent: (index: number) => React.ReactNode },
    _ref: React.Ref<unknown>,
  ) => (
    <div>
      {Array.from({ length: totalCount }, (_, index) => (
        <div key={index}>{itemContent(index)}</div>
      ))}
    </div>
  );
  return {
    Virtuoso: React.forwardRef(renderAll),
    VirtuosoGrid: React.forwardRef((props: VirtuosoGridProps<unknown>, ref) => {
      grid.props = props;
      return renderAll(props as Parameters<typeof renderAll>[0], ref);
    }),
  };
});

const pub = (title: string): OPDSPublication => ({
  metadata: { title },
  links: [],
  images: [],
});

const feedWithGroups = (groupTitles: string[]): OPDSFeed => ({
  metadata: { title: 'Catalog' },
  links: [],
  groups: groupTitles.map((title) => ({
    metadata: { title },
    links: [],
    publications: [pub(`${title} A`), pub(`${title} B`)],
  })),
});

const renderFeed = (feed: OPDSFeed, onPublicationSelect = vi.fn()) =>
  render(
    <FeedView
      feed={feed}
      baseURL='https://opds.example.com/opds'
      resolveURL={(href, base) => new URL(href, base).toString()}
      onNavigate={vi.fn()}
      onPublicationSelect={onPublicationSelect}
      onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
      isOPDSCatalog={() => true}
    />,
  );

describe('FeedView groups', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders each group as a horizontal carousel when there are two or more groups', () => {
    renderFeed(feedWithGroups(['Popular', 'Recent']));

    // One carousel per group, not a vertical grid.
    expect(screen.getAllByTestId('group-carousel')).toHaveLength(2);
    expect(screen.getByText('Popular A')).toBeTruthy();
    expect(screen.getByText('Recent B')).toBeTruthy();
  });

  it('does not use a carousel when there is only one group', () => {
    renderFeed(feedWithGroups(['Only Group']));

    expect(screen.queryByTestId('group-carousel')).toBeNull();
    // Publications still render in the (grid) layout.
    expect(screen.getByText('Only Group A')).toBeTruthy();
  });

  it('shows card authors with Calibre pipes restored to commas, joined by & (issue #5183)', () => {
    const feed: OPDSFeed = {
      metadata: { title: 'Catalog' },
      links: [],
      publications: [
        {
          metadata: {
            title: 'Two Authors',
            author: [
              { name: 'Doe| John Walter', links: [] },
              { name: 'Smith| James Richard', links: [] },
            ],
          },
          links: [],
          images: [],
        },
      ],
    };
    renderFeed(feed);

    expect(screen.getByText('Doe, John Walter & Smith, James Richard')).toBeTruthy();
  });

  it('selects the right publication when a carousel item is clicked', () => {
    const onPublicationSelect = vi.fn();
    renderFeed(feedWithGroups(['Popular', 'Recent']), onPublicationSelect);

    fireEvent.click(screen.getByText('Recent A'));
    expect(onPublicationSelect).toHaveBeenCalledWith(1, 0);
  });
});

describe('FeedView browse position', () => {
  afterEach(cleanup);

  it('restores the complete measured grid state when returning to the same feed', () => {
    const feed: OPDSFeed = {
      metadata: { title: 'Catalog' },
      links: [],
      publications: [pub('Book')],
    };
    const snapshot: GridStateSnapshot = {
      scrollTop: 2400,
      viewport: { width: 800, height: 600 },
      item: { width: 180, height: 290 },
      gap: { column: 16, row: 16 },
    };
    renderFeed(feed);
    expect(grid.props.stateChanged).toBeTypeOf('function');
    grid.props.stateChanged?.(snapshot);
    cleanup();
    renderFeed(feed);
    expect(grid.props.restoreStateFrom).toEqual(snapshot);
    // Virtuoso seeds dimensions before its asynchronous scroll-to is applied.
    // Leaving during that initialization must not replace the saved offset with zero.
    grid.props.stateChanged?.({ ...snapshot, scrollTop: 0 });
    cleanup();
    renderFeed(feed);
    expect(grid.props.restoreStateFrom).toEqual(snapshot);
    grid.props.stateChanged?.(snapshot);
    // Once restored, deliberately scrolling back to the top must be remembered.
    grid.props.stateChanged?.({ ...snapshot, scrollTop: 0 });
    cleanup();
    renderFeed(feed);
    expect(grid.props.restoreStateFrom?.scrollTop).toBe(0);
    cleanup();
    // A freshly fetched payload, even from the same URL, must not reuse stale measurements.
    renderFeed({ metadata: { title: 'Catalog' }, links: [], publications: [pub('New book')] });
    expect(grid.props.restoreStateFrom).toBeUndefined();
  });
});
