/**
 * EPUB CFI (Canonical Fragment Identifier) — a *CFI-shaped* serialization, not
 * a full IDPF-conformance implementation. See design doc §5: generating and
 * resolving spec-perfect CFIs (step-node numbering that interleaves text and
 * element siblings, assertions, ranges) is fiddly enough that the design
 * explicitly calls it a stretch goal. This module produces genuinely
 * `epubcfi(...)`-syntax strings that:
 *
 *  - round-trip through this engine exactly (serialize → parse → resolve
 *    lands back on the same element + character offset), and
 *  - are recognisable to another CFI-aware reader for the common case (a
 *    package document whose `<spine>` is the 3rd top-level child — true for
 *    the overwhelming majority of real-world EPUBs — and elements addressed
 *    by their position among *element* siblings only, ignoring interleaved
 *    text nodes in the step numbering).
 *
 * `Position['anchor']` (block ordinal + flattened-text offset, see anchor.ts)
 * stays the engine's own fast internal format; CFI is the portable export /
 * interchange shape layered on top of it.
 */

export interface ParsedCfi {
  spineIndex: number;
  spineIdref: string;
  /** Element steps from the content document's `<body>` down to the target's parent. */
  steps: number[];
  /** Character offset into the target element's flattened `textContent`. */
  offset: number;
}

/** CFI step for the `n`-th (0-based) child among *element* siblings. */
function stepFor(elementIndex: number): number {
  return 2 * (elementIndex + 1);
}

/** Inverse of {@link stepFor}. */
function indexForStep(step: number): number {
  return step / 2 - 1;
}

/** Element-sibling steps from `doc.body` down to (and including) `el`. */
export function elementSteps(doc: Document, el: Element): number[] {
  const steps: number[] = [];
  let node: Element | null = el;
  while (node && node !== doc.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const idx = Array.from(parent.children).indexOf(node);
    steps.unshift(stepFor(idx));
    node = parent;
  }
  return steps;
}

/** Resolve element-sibling steps back to an element inside `doc`. */
export function resolveCfiElement(doc: Document, steps: number[]): Element | null {
  let node: Element = doc.body;
  for (const step of steps) {
    const idx = indexForStep(step);
    const child: Element | undefined = node.children[idx];
    if (!child) return null;
    node = child;
  }
  return node;
}

/**
 * Serialize a position (an element + flattened-text character offset) inside
 * one spine document to a CFI string.
 */
export function serializeCfi(
  doc: Document,
  spineIndex: number,
  spineIdref: string,
  el: Element,
  offset: number,
): string {
  const steps = elementSteps(doc, el);
  const local = steps.length ? `/${steps.join('/')}` : '';
  // /6/ = conventional package -> spine step (metadata=2, manifest=4, spine=6).
  return `epubcfi(/6/${stepFor(spineIndex)}[${escapeAssertion(spineIdref)}]!${local}:${offset})`;
}

const CFI_RE = /^epubcfi\(\/6\/(\d+)\[((?:[^\]^]|\^.)*)\]!((?:\/\d+)*):(\d+)\)$/;

/** Parse a CFI produced by {@link serializeCfi} (or shaped just like it). */
export function parseCfi(cfi: string): ParsedCfi | null {
  const m = CFI_RE.exec(cfi.trim());
  if (!m) return null;
  const [, spineStepStr, idref, stepsStr, offsetStr] = m;
  return {
    spineIndex: indexForStep(Number(spineStepStr)),
    spineIdref: unescapeAssertion(idref ?? ''),
    steps: (stepsStr ?? '')
      .split('/')
      .filter(Boolean)
      .map((s) => Number(s)),
    offset: Number(offsetStr),
  };
}

/** Resolve a parsed CFI to a `Range` covering one character, or `null` if the doc has drifted. */
export function resolveCfiRange(
  doc: Document,
  parsed: Pick<ParsedCfi, 'steps' | 'offset'>,
): Range | null {
  const el = resolveCfiElement(doc, parsed.steps);
  if (!el) return null;
  return rangeAtOffsetInEl(el, doc, parsed.offset);
}

// Re-implemented locally (not imported from anchor.ts) to keep this module
// standalone/testable without pulling in the pagination-facing RectOf types.
function rangeAtOffsetInEl(el: Element, doc: Document, offset: number): Range | null {
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let base = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (offset < base + len) {
      const range = doc.createRange();
      const local = offset - base;
      range.setStart(node, local);
      range.setEnd(node, Math.min(local + 1, len));
      return range;
    }
    base += len;
  }
  return null;
}

function escapeAssertion(s: string): string {
  return s.replace(/[[\]^,;()!~@]/g, (c) => `^${c}`);
}

function unescapeAssertion(s: string): string {
  return s.replace(/\^(.)/g, '$1');
}
