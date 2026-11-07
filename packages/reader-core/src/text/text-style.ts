import {
  buildBaseStylesheet,
  buildFixedLayoutStylesheet,
  type FixedPageSize,
  type TextLayout,
} from './paginate.js';
import type { TextEngineSettings } from './types.js';

export const THEME_COLORS: Record<
  TextEngineSettings['theme'],
  { color: string; background: string; dark: boolean }
> = {
  // warm, editorial — mirrors the demo shell palette (docs/design-language.md)
  light: { color: '#23201a', background: '#faf7f1', dark: false },
  sepia: { color: '#4a3f30', background: '#f2e7d3', dark: false },
  dark: { color: '#d8d1c4', background: '#17150f', dark: true },
  oled: { color: '#cfc8bb', background: '#000000', dark: true },
};

export interface InjectTextStyleOptions {
  cdoc: Document;
  fontFaceCss?: string | undefined;
  settings: TextEngineSettings;
  layout: TextLayout;
  direction?: 'ltr' | 'rtl' | undefined;
  fixedLayout: boolean;
  fixedPageSize?: FixedPageSize | undefined;
  flow: boolean;
}

/**
 * Inject base typography, theme colors, and bundled font-face declarations
 * into the sandboxed reading iframe document.
 */
export function injectTextStyle(opts: InjectTextStyleOptions): void {
  const { cdoc, fontFaceCss, settings, layout, direction = 'ltr', fixedLayout, fixedPageSize, flow } = opts;

  if (fontFaceCss && !cdoc.getElementById('pore-fonts')) {
    const f = cdoc.createElement('style');
    f.id = 'pore-fonts';
    f.textContent = fontFaceCss;
    cdoc.head?.appendChild(f);
  }

  let el = cdoc.getElementById('pore-base-style') as HTMLStyleElement | null;
  if (!el) {
    el = cdoc.createElement('style');
    el.id = 'pore-base-style';
    cdoc.head?.appendChild(el);
  }

  const theme = THEME_COLORS[settings.theme];
  if (fixedLayout) {
    el.textContent = buildFixedLayoutStylesheet(
      fixedPageSize ?? { width: 800, height: 1000 },
      theme.background,
    );
    return;
  }

  el.textContent = buildBaseStylesheet(layout, {
    fontSizePct: settings.fontSizePct,
    lineHeight: settings.lineHeight,
    textAlign: settings.textAlign,
    fontFamily: settings.fontFamily,
    color: theme.color,
    background: theme.background,
    direction,
    publisherStyles: settings.publisherStyles,
    dimImages: settings.dimImages && theme.dark,
    flow,
  });
}
