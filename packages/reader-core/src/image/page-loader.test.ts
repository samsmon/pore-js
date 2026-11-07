import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLoader } from './page-loader.js';
import type { ReaderSource } from '../source/types.js';

let seq = 0;
beforeEach(() => {
  seq = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => `blob:mock/${++seq}`,
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

function stubSource(over: Partial<ReaderSource> = {}): ReaderSource {
  return {
    getManifest: vi.fn(),
    getPage: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })),
    getFile: vi.fn(),
    loadProgress: vi.fn(async () => null),
    saveProgress: vi.fn(async () => {}),
    ...over,
  } as ReaderSource;
}

describe('PageLoader', () => {
  it('caches a loaded URL and reports bytes', async () => {
    const src = stubSource();
    const loader = new PageLoader({ source: src, bookId: 'b', loadingMethod: 'blob' });
    const u1 = await loader.get(2);
    const u2 = await loader.get(2);
    expect(u1).toBe(u2);
    expect(src.getPage).toHaveBeenCalledTimes(1);
    expect(loader.bytesOf(2)).toBe(4);
    expect(loader.isLoaded(2)).toBe(true);
    expect(loader.getUrl(2)).toBe(u1);
    expect(loader.getUrl(99)).toBeUndefined();
  });

  it('evicts and revokes object URLs outside the retain set + LRU', async () => {
    const src = stubSource();
    const loader = new PageLoader({
      source: src,
      bookId: 'b',
      loadingMethod: 'blob',
      keepExtra: 1,
    });
    await loader.get(0);
    await loader.get(1);
    await loader.get(2);
    loader.retain([2]); // 0 and 1 leave the window; keepExtra:1 keeps only the newest
    expect(loader.isLoaded(2)).toBe(true);
    expect(loader.isLoaded(0)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('decodes an ImageBitmap in bitmap mode and closes it on destroy', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 1200, close })),
    );
    const loader = new PageLoader({ source: stubSource(), bookId: 'b', loadingMethod: 'bitmap' });
    const bmp = await loader.getBitmap(0);
    expect(bmp).toMatchObject({ width: 800, height: 1200 });
    loader.destroy();
    expect(close).toHaveBeenCalled();
  });
});
