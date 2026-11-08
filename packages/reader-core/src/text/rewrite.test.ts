// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteResources } from './rewrite.js';
import type { EpubBook } from './epub/types.js';

let seq = 0;
beforeEach(() => {
  seq = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => `blob:mock/${++seq}`,
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

function fakeBook(files: Record<string, { text: string; type: string }>): EpubBook {
  return {
    metadata: { title: 't', direction: 'ltr', fixedLayout: false },
    spine: [],
    toc: [],
    opfPath: 'OEBPS/content.opf',
    entries: Object.keys(files),
    resource: (href) => {
      const f = files[href];
      return f ? { bytes: new TextEncoder().encode(f.text), mediaType: f.type } : null;
    },
  };
}

describe('rewriteResources', () => {
  it('rewrites img src and drops scripts', () => {
    const book = fakeBook({ 'OEBPS/img/x.png': { text: 'PNG', type: 'image/png' } });
    const { html, urls } = rewriteResources(
      '<html><body><script>alert(1)</script><img src="img/x.png"/></body></html>',
      book,
      'OEBPS/ch01.xhtml',
      new DOMParser(),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('blob:mock/1');
    expect(urls).toHaveLength(1);
  });

  it('rewrites url() inside a <style> block', () => {
    const book = fakeBook({ 'OEBPS/fonts/f.woff2': { text: 'FONT', type: 'font/woff2' } });
    const { html } = rewriteResources(
      '<html><head><style>@font-face{src:url("fonts/f.woff2")}</style></head><body/></html>',
      book,
      'OEBPS/ch01.xhtml',
      new DOMParser(),
    );
    expect(html).toMatch(/url\("blob:mock\/\d+"\)/);
  });

  it('strips author CSS when stripAuthorCss is set', () => {
    const book = fakeBook({ 'OEBPS/pub.css': { text: 'p{color:hotpink}', type: 'text/css' } });
    const { html } = rewriteResources(
      '<html><head><style>p{margin:9px}</style><link rel="stylesheet" href="pub.css"/></head><body><p style="color:red">x</p></body></html>',
      book,
      'OEBPS/ch01.xhtml',
      new DOMParser(),
      { stripAuthorCss: true },
    );
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('style="color:red"');
  });

  it('leaves data: and absolute URLs alone', () => {
    const book = fakeBook({});
    const { html, urls } = rewriteResources(
      '<html><body><img src="data:image/png;base64,AAAA"/><img src="https://x/y.png"/></body></html>',
      book,
      'OEBPS/ch01.xhtml',
      new DOMParser(),
    );
    expect(html).toContain('data:image/png');
    expect(html).toContain('https://x/y.png');
    expect(urls).toHaveLength(0);
  });

  it('rewrites SVG <image xlink:href> and <use xlink:href> to blob URLs', () => {
    const book = fakeBook({ 'OEBPS/images/cover.jpg': { text: 'JPG', type: 'image/jpeg' } });
    const { html, urls } = rewriteResources(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 800"><image width="600" height="800" xlink:href="images/cover.jpg"/></svg></body></html>',
      book,
      'OEBPS/cover.xhtml',
      new DOMParser(),
    );
    expect(html).toContain('xlink:href="blob:mock/1"');
    expect(urls).toHaveLength(1);
  });
});
