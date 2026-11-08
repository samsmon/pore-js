const ALLOWED_TAGS = new Set([
  'p',
  'span',
  'a',
  'em',
  'strong',
  'i',
  'b',
  'u',
  's',
  'sup',
  'sub',
  'br',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'blockquote',
  'dl',
  'dt',
  'dd',
  'aside',
  'section',
  'div',
  'button',
]);

const DROP_SUBTREE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'head',
  'title',
  'noscript',
  'template',
]);

const ALLOWED_ATTRS = new Set([
  'href',
  'id',
  'title',
  'class',
  'dir',
  'lang',
  'epub:type',
  'role',
  'aria-label',
]);

function isSafeHref(raw: string): boolean {
  const cleaned = raw
    .split('')
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && !/\s/.test(c))
    .join('');
  if (!cleaned) return false;
  if (
    cleaned.startsWith('#') ||
    cleaned.startsWith('/') ||
    cleaned.startsWith('./') ||
    cleaned.startsWith('../')
  ) {
    return true;
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    return true; // relative path without scheme
  }
  const scheme = schemeMatch[1]!.toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

/**
 * Sanitizes HTML content for footnotes using a strict tag and attribute allowlist
 * to prevent cross-site scripting (XSS), SVG/MathML mutation vectors, and host CSS injection.
 */
export function sanitizeFootnoteHtml(html: string): string {
  if (!html) return '';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    for (const tag of DROP_SUBTREE_TAGS) {
      for (const el of Array.from(doc.querySelectorAll(tag))) {
        el.remove();
      }
    }

    const elements = Array.from(doc.body.querySelectorAll('*'));
    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        } else {
          el.remove();
        }
        continue;
      }

      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'href' && !isSafeHref(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }

    return doc.body.innerHTML;
  }

  // Fallback for environments without DOMParser: strip all tags except basic inline text
  return html
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '');
}
