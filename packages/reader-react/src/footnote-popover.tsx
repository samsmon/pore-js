import * as Popover from '@radix-ui/react-popover';
import { sanitizeFootnoteHtml } from 'porejs/internal';
import { useFootnote } from './reader.js';

/**
 * Renders the active footnote (from `reader:footnote`) as a Radix `Popover`
 * so it gets a focus scope, escape-to-close and outside-click dismissal.
 * Unanchored (the noteref lives inside the reader iframe), so it centres via
 * the consumer's `data-pore-footnote` styles.
 */
export function FootnotePopover({ className }: { className?: string }) {
  const [footnote, clear] = useFootnote();
  const safeHtml = footnote ? sanitizeFootnoteHtml(footnote.html) : '';
  return (
    <Popover.Root open={!!footnote} onOpenChange={(o) => !o && clear()}>
      <Popover.Anchor />
      <Popover.Portal>
        <Popover.Content
          className={className ?? 'footnote'}
          data-pore-footnote
          role="dialog"
          aria-label="Footnote"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Popover.Close className="footnote__close" aria-label="Close" data-pore-footnote-close>
            ×
          </Popover.Close>
          {safeHtml ? <div dangerouslySetInnerHTML={{ __html: safeHtml }} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
