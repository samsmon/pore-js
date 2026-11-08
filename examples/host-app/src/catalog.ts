/**
 * The host site's own content model. Nothing here is a porejs type — this is
 * whatever your CMS / API already has. `library-source.ts` adapts it.
 */
export interface Series {
  slug: string;
  title: string;
  author: string;
  hue: number; // just for the generated placeholder art
}

export interface Volume {
  id: string; // the porejs `bookId`
  seriesSlug: string;
  volume: number;
  chapterTitle: string;
  pageCount: number;
  direction: 'ltr' | 'rtl';
}

export const SERIES: Series[] = [
  { slug: 'tidepool', title: 'Tidepool', author: 'R. Marlow', hue: 190 },
  { slug: 'emberline', title: 'Emberline', author: 'K. Voss', hue: 20 },
];

export const VOLUMES: Volume[] = [
  {
    id: 'tidepool-v1',
    seriesSlug: 'tidepool',
    volume: 1,
    chapterTitle: 'Low Water',
    pageCount: 8,
    direction: 'rtl',
  },
  {
    id: 'tidepool-v2',
    seriesSlug: 'tidepool',
    volume: 2,
    chapterTitle: 'The Spring Tide',
    pageCount: 10,
    direction: 'rtl',
  },
  {
    id: 'emberline-v1',
    seriesSlug: 'emberline',
    volume: 1,
    chapterTitle: 'Kindling',
    pageCount: 9,
    direction: 'ltr',
  },
];

export const seriesOf = (v: Volume) => SERIES.find((s) => s.slug === v.seriesSlug)!;
export const volumeOf = (id: string) => VOLUMES.find((v) => v.id === id);
