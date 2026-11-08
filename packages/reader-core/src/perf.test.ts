// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSpreads } from './image/spreads.js';
import { buildSearchIndex, querySearchIndex, type SearchSection } from './search/search-index.js';
import { elementSteps, parseCfi, resolveCfiElement, serializeCfi } from './text/cfi.js';

/**
 * Not benchmarks — guard rails. Budgets are ~10× a warm local run so a genuine
 * algorithmic regression (an O(n²) sneaking in) trips them, but a slow CI box
 * doesn't. If one fails, profile the named function, don't just bump the number.
 */
const budget = (label: string, ms: number, fn: () => void) =>
  it(`${label} stays under ${ms}ms`, () => {
    fn(); // warm
    const t = performance.now();
    fn();
    const took = performance.now() - t;
    expect(took, `${label} took ${took.toFixed(1)}ms`).toBeLessThan(ms);
  });

describe('perf guard rails', () => {
  budget('buildSpreads — 5000-page double-spread book', 40, () => {
    const pages = Array.from({ length: 5000 }, (_, index) => ({
      index,
      isWide: index % 17 === 0, // scattered wide pages force re-pairing
    }));
    const spreads = buildSpreads(pages, {
      layout: 'paged-double',
      direction: 'rtl',
      spreadOffset: 0,
    });
    expect(spreads.length).toBeGreaterThan(2500);
  });

  budget('buildSearchIndex + 20 queries — 800 sections', 250, () => {
    const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do'.split(' ');
    const sections: SearchSection[] = Array.from({ length: 800 }, (_, index) => ({
      id: `s${index}`,
      index,
      text: Array.from({ length: 300 }, (_, w) => words[(index + w) % words.length]).join(' '),
    }));
    const idx = buildSearchIndex(sections);
    for (let i = 0; i < 20; i++) querySearchIndex(idx, 'consectetur adipiscing', { limit: 50 });
  });

  // A realistic chapter shape: ~40 sections, each ~15 paragraphs, some nesting.
  // (jsdom's HTMLCollection is slow, so budgets here are loose — the guard is
  // against an algorithmic regression, e.g. elementSteps going quadratic.)
  budget('CFI serialize+parse+resolve — realistic chapter DOM ×40', 250, () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><body>${Array.from(
        { length: 40 },
        (_, s) =>
          `<section id="s${s}"><h2>Section ${s}</h2>${Array.from(
            { length: 15 },
            (_, p) =>
              `<p id="s${s}p${p}">para ${p} with <em>emphasis</em> and <span>a span</span>.</p>`,
          ).join('')}</section>`,
      ).join('')}</body>`,
      'text/html',
    );
    for (let s = 0; s < 40; s++) {
      const el = doc.getElementById(`s${s}p${s % 15}`)!;
      void elementSteps(doc, el);
      const cfi = serializeCfi(doc, 3, 'chap', el, 4);
      const parsed = parseCfi(cfi)!;
      expect(resolveCfiElement(doc, parsed.steps)).toBe(el);
    }
  });
});
