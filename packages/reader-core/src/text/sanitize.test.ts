// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeFootnoteHtml } from './sanitize.js';

describe('sanitizeFootnoteHtml (SEC-01)', () => {
  it('strips script, iframe, object, embed, style, svg, and math subtrees', () => {
    const input =
      '<div>' +
      '<p>Text</p>' +
      '<script>alert(1)</script>' +
      '<SCRIPT>console.log("bad")</SCRIPT>' +
      '<style>body { display: none; }</style>' +
      '<iframe src="https://attacker.com"></iframe>' +
      '<object data="evil.swf"></object>' +
      '<embed src="evil.swf">' +
      '<svg><a id="x"><animate attributeName="href" values="javascript:alert(1)"/><text>click</text></a></svg>' +
      '<math><mtext>bad</mtext></math>' +
      '</div>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain('<p>Text</p>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<SCRIPT');
    expect(output).not.toContain('<style');
    expect(output).not.toContain('display: none');
    expect(output).not.toContain('<iframe');
    expect(output).not.toContain('<object');
    expect(output).not.toContain('<embed');
    expect(output).not.toContain('<svg');
    expect(output).not.toContain('<animate');
    expect(output).not.toContain('<math');
  });

  it('strips inline on* event handlers and disallowed attributes', () => {
    const input =
      '<button onclick="alert(1)" ONLOAD="steal()" onmouseover="track()" style="color:red" data-evil="1">Click</button>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain('<button');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('ONLOAD');
    expect(output).not.toContain('onmouseover');
    expect(output).not.toContain('style=');
    expect(output).not.toContain('data-evil');
  });

  it('blocks javascript:, data:, and vbscript: URLs in href and unwraps img tags', () => {
    const input =
      '<a href="javascript:alert(1)">Link 1</a>' +
      '<a href="  javascript:alert(2)">Link 2</a>' +
      '<a href="data:text/html,<script>alert(3)</script>">Link 3</a>' +
      '<a href="vbscript:msgbox(1)">Link 4</a>' +
      '<img src="javascript:alert(5)">' +
      '<img src="https://tracker.example.com/pixel.gif">';
    const output = sanitizeFootnoteHtml(input);
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('data:text/html');
    expect(output).not.toContain('vbscript:');
    expect(output).not.toContain('<img');
  });

  it('preserves safe formatting, links, and text', () => {
    const input =
      '<p>Note text with <em>emphasis</em>, <a href="#fn1">anchor</a>, and <a href="https://example.com">safe link</a>.</p>';
    const output = sanitizeFootnoteHtml(input);
    expect(output).toContain(
      '<p>Note text with <em>emphasis</em>, <a href="#fn1">anchor</a>, and <a href="https://example.com">safe link</a>.</p>',
    );
  });

  it('handles empty input gracefully', () => {
    expect(sanitizeFootnoteHtml('')).toBe('');
  });
});
