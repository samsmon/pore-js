// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeFootnoteHtml } from './sanitize.js';

describe('sanitizeFootnoteHtml (SEC-01)', () => {
  it('strips script, iframe, object, and embed tags', () => {
    const input =
      '<div>' +
      '<p>Text</p>' +
      '<script>alert(1)</script>' +
      '<SCRIPT>console.log("bad")</SCRIPT>' +
      '<iframe src="https://attacker.com"></iframe>' +
      '<object data="evil.swf"></object>' +
      '<embed src="evil.swf">' +
      '</div>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain('<p>Text</p>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<SCRIPT');
    expect(output).not.toContain('<iframe');
    expect(output).not.toContain('<object');
    expect(output).not.toContain('<embed');
  });

  it('strips inline on* event handlers', () => {
    const input = '<button onclick="alert(1)" ONLOAD="steal()" onmouseover="track()">Click</button>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain('<button');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('ONLOAD');
    expect(output).not.toContain('onmouseover');
  });

  it('strips javascript: pseudo-protocol in href and src', () => {
    const input =
      '<a href="javascript:alert(1)">Link 1</a>' +
      '<a href="  javascript:alert(2)">Link 2</a>' +
      '<img src="javascript:alert(3)">';
    const output = sanitizeFootnoteHtml(input);
    expect(output).not.toContain('javascript:');
  });

  it('preserves safe formatting, links, and text', () => {
    const input = '<p>Note text with <em>emphasis</em> and <a href="https://example.com">safe link</a>.</p>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain('<p>Note text with <em>emphasis</em> and <a href="https://example.com">safe link</a>.</p>');
  });

  it('handles empty input gracefully', () => {
    expect(sanitizeFootnoteHtml('')).toBe('');
  });
});
