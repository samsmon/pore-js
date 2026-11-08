import type { EpubBook } from './epub/types.js';
import { dirOf, resolvePath, stripHash } from './epub/path.js';

const decoder = new TextDecoder();

export interface RewriteResult {
  html: string;
  /** Object URLs created — the engine revokes these on teardown. */
  urls: string[];
}

export interface RewriteOptions {
  /** Drop author `<style>` / `<link rel=stylesheet>` (publisher styles off). */
  stripAuthorCss?: boolean;
}

/**
 * Rewrite a spine document's resource references (`src`, `href`, CSS `url()`)
 * to `blob:` URLs so it can render inside a scriptless sandboxed iframe.
 * `<script>` elements are dropped; author CSS optionally too.
 */
export function rewriteResources(
  xhtml: string,
  book: EpubBook,
  spineHref: string,
  parser: DOMParser,
  opts: RewriteOptions = {},
): RewriteResult {
  const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
  const root =
    doc.getElementsByTagName('parsererror').length > 0
      ? parser.parseFromString(xhtml, 'text/html')
      : doc;

  const baseDir = dirOf(spineHref);
  const urls: string[] = [];
  const cache = new Map<string, string>();

  const toBlobUrl = (rawHref: string): string | null => {
    const path = resolvePath(baseDir, rawHref);
    if (cache.has(path)) return cache.get(path)!;
    const res = book.resource(path) ?? book.resource(stripHash(rawHref));
    if (!res) return null;
    let bytes: BlobPart = res.bytes as unknown as BlobPart;
    if (res.mediaType === 'text/css') {
      bytes = rewriteCssUrls(decoder.decode(res.bytes), dirOf(path), book, urls, cache);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mediaType }));
    urls.push(url);
    cache.set(path, url);
    return url;
  };

  // Scripts never run in the reading frame. Drop <script>, inline on* handlers,
  // and javascript: URLs — defence in depth behind the frame's CSP + sandbox.
  for (const el of Array.from(root.querySelectorAll('script'))) el.remove();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (
        (attr.name === 'href' || attr.name === 'src' || attr.name === 'xlink:href') &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const el of Array.from(root.querySelectorAll('iframe, object, embed, meta[http-equiv]'))) {
    el.remove();
  }

  // A strict Content-Security-Policy in the frame: no scripts (even if one slips
  // past the strip above), no plugins, no nested frames, no form posts, no
  // base-uri games. The frame still gets `allow-scripts` in its sandbox purely
  // so WebKit delivers pointer/selection events to the engine's listeners —
  // this CSP is what actually keeps scripts from running.
  const rdoc = root as unknown as Document;
  const csp = rdoc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute(
    'content',
    "default-src 'none'; img-src blob: data:; media-src blob: data:; " +
      "font-src blob: data:; style-src 'unsafe-inline' blob: data:; " +
      "script-src 'none'; object-src 'none'; frame-src 'none'; " +
      "base-uri 'none'; form-action 'none'",
  );
  const head = root.querySelector('head');
  if (head) head.insertBefore(csp, head.firstChild);
  else root.documentElement?.insertBefore(csp, root.documentElement.firstChild);

  if (opts.stripAuthorCss) {
    for (const el of Array.from(root.querySelectorAll('style, link[rel~="stylesheet"]'))) {
      el.remove();
    }
    for (const el of Array.from(root.querySelectorAll('[style]'))) el.removeAttribute('style');
  }

  for (const el of Array.from(root.querySelectorAll('[src]'))) {
    const v = el.getAttribute('src');
    const url = v ? toBlobUrl(v) : null;
    if (url) el.setAttribute('src', url);
  }
  for (const el of Array.from(root.querySelectorAll('link[href], image[href], use[href]'))) {
    const v = el.getAttribute('href');
    const url = v ? toBlobUrl(v) : null;
    if (url) el.setAttribute('href', url);
  }
  for (const el of Array.from(root.querySelectorAll('image, use'))) {
    const v = el.getAttribute('xlink:href');
    const url = v ? toBlobUrl(v) : null;
    if (url) el.setAttribute('xlink:href', url);
  }
  for (const style of Array.from(root.querySelectorAll('style'))) {
    if (style.textContent) {
      style.textContent = rewriteCssUrls(style.textContent, baseDir, book, urls, cache);
    }
  }

  const serialized =
    root instanceof Document
      ? new XMLSerializer().serializeToString(root)
      : (root as unknown as Document).documentElement.outerHTML;

  return { html: serialized, urls };
}

function rewriteCssUrls(
  css: string,
  baseDir: string,
  book: EpubBook,
  urls: string[],
  cache: Map<string, string>,
): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, ref: string) => {
    if (/^(data:|https?:|blob:)/i.test(ref)) return whole;
    const path = resolvePath(baseDir, ref);
    let url = cache.get(path);
    if (!url) {
      const res = book.resource(path);
      if (!res) return whole;
      url = URL.createObjectURL(
        new Blob([res.bytes as unknown as BlobPart], { type: res.mediaType }),
      );
      urls.push(url);
      cache.set(path, url);
    }
    return `url("${url}")`;
  });
}
