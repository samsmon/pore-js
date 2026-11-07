import { blockElements, pageForElement, type RectOf } from './anchor.js';
import { rangeForHighlight } from './highlight.js';
import {
  createTtsController,
  segmentSentences,
  type TtsController,
  type TtsSentence,
  type TtsState,
  type TtsSynthLike,
  type TtsUtteranceLike,
  type TtsVoiceLike,
} from './tts.js';

interface HighlightWindow extends Window {
  CSS?: {
    highlights?: {
      set(name: string, highlight: unknown): void;
      delete(name: string): void;
    };
  };
  Highlight?: new (range: Range) => unknown;
}

/** One TTS sentence per `Intl.Segmenter` split of each block's flattened text — same block-ordinal addressing as `HighlightRange`. */
export function sentencesForSpine(cdoc: Document): TtsSentence[] {
  const blocks = blockElements(cdoc);
  const out: TtsSentence[] = [];
  blocks.forEach((el, block) => {
    for (const s of segmentSentences(el.textContent ?? '')) {
      out.push({ block, start: s.start, end: s.end, text: s.text });
    }
  });
  return out;
}

export function clearTtsHighlight(cdoc: Document): void {
  const win = cdoc.defaultView as unknown as HighlightWindow | null;
  win?.CSS?.highlights?.delete('pore-tts');
  cdoc.querySelectorAll('mark.pore-tts').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
}

/** Paint the currently-spoken sentence — its own highlight name/class, kept separate from user highlights. */
export function paintTtsSentence(cdoc: Document, range: Range | null): void {
  clearTtsHighlight(cdoc);
  if (!range) return;
  const win = cdoc.defaultView as unknown as HighlightWindow | null;
  if (win?.CSS?.highlights && win.Highlight) {
    let style = cdoc.getElementById('pore-tts-style') as HTMLStyleElement | null;
    if (!style) {
      style = cdoc.createElement('style');
      style.id = 'pore-tts-style';
      cdoc.head?.appendChild(style);
    }
    style.textContent = '::highlight(pore-tts){background-color:#fde68a99;}';
    win.CSS.highlights.set('pore-tts', new win.Highlight(range));
    return;
  }
  try {
    const mark = cdoc.createElement('mark');
    mark.className = 'pore-tts';
    mark.style.backgroundColor = '#fde68a99';
    range.surroundContents(mark);
  } catch {
    // a sentence spanning more than one element can't be wrapped in a
    // single <mark> — playback continues, just unpainted in this path.
  }
}

export interface TextTtsCoordinatorOptions {
  synth?: TtsSynthLike | null | undefined;
  createUtterance?: ((text: string) => TtsUtteranceLike) | undefined;
  getDocument: () => Document | null;
  getSpineIndex: () => number;
  getSpinePageCount: () => number;
  getCurrentPage: () => number;
  getPageStep: () => number;
  relRectOf: RectOf;
  isPagingEligible: () => boolean;
  onNavigateToPage: (page: number) => void;
  advanceSpine: () => Promise<boolean>;
  onStateChange: (state: TtsState) => void;
}

/**
 * Coordinates text-to-speech reading: audio synthesis, sentence highlighting,
 * auto-advance across pages, and spine document transitions.
 */
export class TextTtsCoordinator {
  #synth: TtsSynthLike | null = null;
  #controller: TtsController;
  #getDocument: () => Document | null;

  constructor(opts: TextTtsCoordinatorOptions) {
    this.#synth = opts.synth ?? null;
    this.#getDocument = opts.getDocument;

    const onSentence = (sentence: TtsSentence | null) => {
      const cdoc = opts.getDocument();
      if (!cdoc) return;
      const blocks = blockElements(cdoc);
      const range = sentence
        ? rangeForHighlight(cdoc, blocks, {
            spine: opts.getSpineIndex(),
            startBlock: sentence.block,
            startOffset: sentence.start,
            endBlock: sentence.block,
            endOffset: sentence.end,
          })
        : null;
      paintTtsSentence(cdoc, range);
      if (!sentence) return;
      const el = blocks[sentence.block];
      if (!el || !opts.isPagingEligible()) return;
      const target = Math.min(
        pageForElement(el, opts.getPageStep(), opts.relRectOf),
        Math.max(0, opts.getSpinePageCount() - 1),
      );
      if (target !== opts.getCurrentPage()) {
        opts.onNavigateToPage(target);
      }
    };

    const createUtterance =
      opts.createUtterance ??
      ((text: string) => new SpeechSynthesisUtterance(text) as unknown as TtsUtteranceLike);

    this.#controller = createTtsController({
      synth: opts.synth ?? {
        speak: () => {},
        pause: () => {},
        resume: () => {},
        cancel: () => {},
        getVoices: () => [],
      },
      createUtterance,
      getSentences: () => {
        const cdoc = opts.getDocument();
        return cdoc ? sentencesForSpine(cdoc) : [];
      },
      onSentence,
      advanceSpine: opts.advanceSpine,
      onStateChange: opts.onStateChange,
    });
  }

  play(): void {
    if (this.#synth) this.#controller.play();
  }

  pause(): void {
    if (this.#synth) this.#controller.pause();
  }

  resume(): void {
    if (this.#synth) this.#controller.resume();
  }

  stop(): void {
    this.#controller.stop();
    const cdoc = this.#getDocument();
    if (cdoc) clearTtsHighlight(cdoc);
  }

  setRate(rate: number): void {
    this.#controller.setRate(rate);
  }

  setVoice(voice: TtsVoiceLike | null): void {
    this.#controller.setVoice(voice);
  }

  listVoices(): TtsVoiceLike[] {
    return this.#synth ? this.#controller.listVoices() : [];
  }

  getState(): TtsState {
    return this.#controller.getState();
  }

  clearHighlight(): void {
    const cdoc = this.#getDocument();
    if (cdoc) clearTtsHighlight(cdoc);
  }
}
