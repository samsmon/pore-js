/**
 * Sanitizes HTML content for footnotes to prevent cross-site scripting (XSS):
 * - Strips `<script>`, `<iframe>`, `<object>`, `<embed>` tags.
 * - Strips inline event handler attributes (`onclick`, `onload`, etc.).
 * - Strips `javascript:` URLs in attributes (`href`, `src`, `action`, etc.).
 */
export function sanitizeFootnoteHtml(html: string): string {
  if (!html) return '';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove forbidden tags
    const forbiddenTags = ['script', 'iframe', 'object', 'embed'];
    for (const tag of forbiddenTags) {
      const elements = doc.querySelectorAll(tag);
      for (const el of Array.from(elements)) {
        el.remove();
      }
    }

    // Inspect all remaining elements and sanitize attributes
    const elements = doc.querySelectorAll('*');
    for (const el of Array.from(elements)) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value
          .split('')
          .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && !/\s/.test(c))
          .join('')
          .toLowerCase();

        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (
          (name === 'href' || name === 'src' || name === 'action' || name === 'formaction' || name === 'xlink:href') &&
          value.startsWith('javascript:')
        ) {
          el.removeAttribute(attr.name);
        }
      }
    }

    return doc.body.innerHTML;
  }

  // Fallback for environments without DOMParser
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=[^\s>]+/gi, '')
    .replace(/(href|src|action|formaction)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1=""');
}
