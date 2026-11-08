/**
 * DOM <-> `HighlightRange` conversions: turning a live text selection into the
 * same block-ordinal + flattened-text-offset addressing `anchor.ts` uses for
 * resume positions, and back into a `Range` for rendering. Kept standalone
 * from `anchor.ts` (single-offset resume points) since a highlight needs two
 * endpoints, possibly in different blocks.
 */
import type { HighlightRange } from '../source/types.js';

/** Text-node + local offset for `offset` chars into `el`'s flattened text — the endpoint counterpart of `anchor.ts`'s `rangeAtOffset`. */
export function locateOffset(
  el: Element,
  doc: Document,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let base = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (offset <= base + len) return { node: node as Text, offset: offset - base };
    base += len;
  }
  return null;
}

/**
 * A DOM `Range` boundary point's `node`/`offset` follows the spec: for a text
 * node, `offset` is a character index; for anything else (e.g. an element —
 * what `Range.selectNodeContents(el)` produces, and what some browsers give
 * for a whole-block drag-selection), `offset` indexes into `node.childNodes`
 * instead. Reduce either shape to an actual text node + local offset.
 */
function textBoundaryPoint(node: Node, offset: number): { node: Node; offset: number } {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset };
  const children = node.childNodes;
  if (offset < children.length) {
    // "immediately before children[offset]" — descend into its first text node
    let target: Node = children[offset]!;
    while (target.nodeType !== Node.TEXT_NODE && target.firstChild) target = target.firstChild;
    return target.nodeType === Node.TEXT_NODE ? { node: target, offset: 0 } : { node, offset };
  }
  // "immediately after the last child" — the end of node's own text content
  let target: Node = node;
  while (target.nodeType !== Node.TEXT_NODE && target.lastChild) target = target.lastChild;
  return target.nodeType === Node.TEXT_NODE
    ? { node: target, offset: target.textContent?.length ?? 0 }
    : { node, offset };
}

/** Character offset (into `el`'s flattened `textContent`) of a Range boundary point (`node`/`nodeOffset`, element- or text-node-relative per DOM Range semantics), or `null` when it isn't inside `el`. */
export function offsetOfPoint(
  el: Element,
  doc: Document,
  node: Node,
  nodeOffset: number,
): number | null {
  if (!el.contains(node)) return null;
  const point = textBoundaryPoint(node, nodeOffset);
  if (point.node.nodeType !== Node.TEXT_NODE) return el === point.node ? 0 : null;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let base = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === point.node) return base + point.offset;
    base += n.textContent?.length ?? 0;
  }
  return null;
}

/** Build a `Range` spanning a highlight's endpoints, resolved against `blocks` (from `blockElements`). */
export function rangeForHighlight(
  doc: Document,
  blocks: Element[],
  h: HighlightRange,
): Range | null {
  const startEl = blocks[h.startBlock];
  const endEl = blocks[h.endBlock];
  if (!startEl || !endEl) return null;
  const start = locateOffset(startEl, doc, h.startOffset);
  const end = locateOffset(endEl, doc, h.endOffset);
  if (!start || !end) return null;
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** Convert a live user-selection `Range` into block-ordinal + offset endpoints (`spine` is left `0`; callers stamp the real spine index). */
export function highlightRangeFromSelection(
  doc: Document,
  blocks: Element[],
  range: Range,
): HighlightRange | null {
  const startBlock = blocks.findIndex((b) => b.contains(range.startContainer));
  const endBlock = blocks.findIndex((b) => b.contains(range.endContainer));
  if (startBlock === -1 || endBlock === -1) return null;
  const startOffset = offsetOfPoint(
    blocks[startBlock]!,
    doc,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = offsetOfPoint(blocks[endBlock]!, doc, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) return null;
  return { spine: 0, startBlock, startOffset, endBlock, endOffset };
}
