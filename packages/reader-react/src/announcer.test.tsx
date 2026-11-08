// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { ReaderAnnouncer } from './announcer.js';
import * as readerModule from './reader.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReaderAnnouncer (A11Y-02)', () => {
  it('announces chapter, page number, and percent through book', async () => {
    vi.useFakeTimers();
    vi.spyOn(readerModule, 'useReaderProgress').mockReturnValue({
      locator: {
        page: 4,
        total: 20,
        percent: 0.25,
        label: '',
        position: { type: 'page', value: 4, total: 20 },
      },
      percent: 0.25,
      chapterLabel: 'Prologue',
      chapterIndex: 0,
      chapterCount: 3,
      pagesLeftInChapter: 2,
      minutesLeft: 5,
      page: 4,
      pageCount: 20,
    });

    render(<ReaderAnnouncer debounceMs={100} />);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toBe(
      'Prologue, chapter 1 of 3. Page 5 of 20. 25% through the book. About 5 minutes left.',
    );

    vi.useRealTimers();
  });
});
