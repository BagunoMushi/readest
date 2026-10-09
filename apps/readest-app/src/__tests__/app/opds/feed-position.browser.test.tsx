import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { OPDSFeed } from '@/types/opds';
import { FeedView } from '@/app/opds/components/FeedView';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/components/CachedImage', () => ({
  CachedImage: ({ alt }: { alt: string }) => <span role='img' aria-label={alt} />,
}));
await import('@/styles/globals.css');

afterEach(cleanup);
const feed = (name: string, count = 400): OPDSFeed => ({
  metadata: { title: name },
  links: [],
  publications: Array.from({ length: count }, (_, index) => ({
    metadata: { title: `${name} Book ${index}` },
    links: [],
    images: [],
  })),
});
const view = (value: OPDSFeed) => (
  <main style={{ height: 600 }}>
    <FeedView
      feed={value}
      baseURL='https://example.test/opds'
      resolveURL={(href, base) => new URL(href, base).href}
      onNavigate={vi.fn()}
      onPublicationSelect={vi.fn()}
      onGenerateCachedImageUrl={async (url) => url}
      isOPDSCatalog={() => true}
    />
  </main>
);
const scroller = () => document.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
async function scrollTo(top: number) {
  await waitFor(() => expect(scroller().scrollHeight).toBeGreaterThan(top + 600));
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
  await waitFor(() => expect(scroller().scrollTop).toBe(top));
  await waitFor(() => expect(document.querySelector('h3')?.textContent).not.toContain('Book 0'));
}

describe('OPDS browse position with real virtualized layout', () => {
  it('restores the book and offset after unmount, including repeated immediate returns', async () => {
    await page.viewport(900, 800);
    const catalog = feed('Catalog');
    render(view(catalog));
    await scrollTo(4200);
    const title = document.querySelector('h3')!.textContent!;
    expect(document.querySelectorAll('h3').length).toBeLessThan(400);
    cleanup(); // Publication detail unmounts FeedView.
    for (let visit = 0; visit < 3; visit++) {
      render(view(catalog));
      cleanup(); // Leave again before the restored scroll event has to fire.
    }
    for (let visit = 0; visit < 3; visit++) {
      render(view(catalog));
      await waitFor(() => expect(scroller().scrollTop).toBe(4200));
      await waitFor(() => expect(document.body.textContent).toContain(title));
      cleanup();
    }
  });

  it('keeps separate history feeds isolated and starts refreshed content at the top', async () => {
    await page.viewport(900, 800);
    const first = feed('First');
    const second = feed('Second');
    render(view(first));
    await scrollTo(2400);
    cleanup();
    render(view(second));
    expect(scroller().scrollTop).toBe(0);
    await scrollTo(1200);
    cleanup();
    render(view(first));
    await waitFor(() => expect(scroller().scrollTop).toBe(2400));
    cleanup();
    render(view(second));
    await waitFor(() => expect(scroller().scrollTop).toBe(1200));
    cleanup();
    render(view(feed('First', 2)));
    await waitFor(() => expect(document.querySelectorAll('h3')).toHaveLength(2));
    expect(scroller().scrollTop).toBe(0);
  });

  it('renders a usable grid after the viewport changes while detail is open', async () => {
    await page.viewport(900, 800);
    const catalog = feed('Resize');
    render(view(catalog));
    await scrollTo(2400);
    cleanup();
    await page.viewport(390, 800);
    render(view(catalog));
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0));
    await waitFor(() => expect(document.querySelectorAll('h3').length).toBeGreaterThan(3));
    expect(scroller().scrollWidth).toBeLessThanOrEqual(scroller().clientWidth);
    await scrollTo(3000);
  });
});
