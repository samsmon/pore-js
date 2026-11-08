/**
 * Text-to-speech: sentence segmentation (pure, testable without the Web
 * Speech API) plus a small state machine that drives an injected synth. See
 * docs/m4-plan.md F5 — explicitly a stretch goal, EPUB-only, browser
 * `SpeechSynthesis` only (no cloud voices, no audio export).
 */

export interface SentenceSpan {
  /** Character offset into the source text where the sentence starts. */
  start: number;
  /** Character offset where it ends (exclusive). */
  end: number;
  /** Trimmed sentence text, ready to hand to a speech synthesizer. */
  text: string;
}

/**
 * Split flattened block text into sentences. Uses `Intl.Segmenter` (sentence
 * granularity) where available; falls back to a punctuation-based regex.
 */
export function segmentSentences(text: string): SentenceSpan[] {
  if (!text.trim()) return [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    const spans: SentenceSpan[] = [];
    for (const { segment, index } of segmenter.segment(text)) {
      const trimmed = segment.trim();
      if (trimmed) spans.push({ start: index, end: index + segment.length, text: trimmed });
    }
    return spans;
  }
  const spans: SentenceSpan[] = [];
  const re = /[^.!?]+[.!?]+(?:\s+|$)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text))) {
    const trimmed = m[0].trim();
    if (trimmed) spans.push({ start: m.index, end: m.index + m[0].length, text: trimmed });
    last = re.lastIndex;
  }
  if (last < text.length) {
    const rest = text.slice(last);
    const trimmed = rest.trim();
    if (trimmed)
      spans.push({ start: last + rest.indexOf(trimmed), end: text.length, text: trimmed });
  }
  return spans;
}

/** A sentence located within the current spine's blocks (block-ordinal addressing, same scheme as `HighlightRange`). */
export interface TtsSentence {
  block: number;
  start: number;
  end: number;
  text: string;
}

export interface TtsVoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface TtsUtteranceLike {
  rate: number;
  voice: TtsVoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** Structural subset of the DOM `SpeechSynthesis` interface — real `speechSynthesis` satisfies this as-is. */
export interface TtsSynthLike {
  speak(utterance: TtsUtteranceLike): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  getVoices(): TtsVoiceLike[];
}

export interface TtsState {
  playing: boolean;
  sentence: TtsSentence | null;
  rate: number;
  voice: TtsVoiceLike | null;
}

export interface TtsControllerOptions {
  synth: TtsSynthLike;
  createUtterance: (text: string) => TtsUtteranceLike;
  /** Sentences for the *current* spine — called fresh each time, since the spine may have changed. */
  getSentences: () => TtsSentence[];
  /** The sentence about to be spoken (or `null` to clear) — the host highlights/scrolls to it. */
  onSentence: (sentence: TtsSentence | null) => void;
  /** Called when sentences run out for the current spine. Resolve `true` if a next spine was loaded (continues from its start), `false` to stop. */
  advanceSpine: () => Promise<boolean>;
  onStateChange: (state: TtsState) => void;
}

export interface TtsController {
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  setVoice(voice: TtsVoiceLike | null): void;
  listVoices(): TtsVoiceLike[];
  getState(): TtsState;
}

export function createTtsController(opts: TtsControllerOptions): TtsController {
  let sentences: TtsSentence[] = [];
  let index = -1;
  let playing = false;
  let rate = 1;
  let voice: TtsVoiceLike | null = null;
  let generation = 0; // bumped on stop()/a fresh play() so a stray async advanceSpine can't resurrect a dead run

  const emit = () => opts.onStateChange(getState());
  const getState = (): TtsState => ({ playing, sentence: sentences[index] ?? null, rate, voice });

  const speakIndex = (gen: number) => {
    if (gen !== generation) return;
    const sentence = sentences[index];
    if (!sentence) {
      void opts.advanceSpine().then((advanced) => {
        if (gen !== generation) return;
        if (!advanced) {
          playing = false;
          opts.onSentence(null);
          emit();
          return;
        }
        sentences = opts.getSentences();
        index = 0;
        speakIndex(gen);
      });
      return;
    }
    opts.onSentence(sentence);
    const utterance = opts.createUtterance(sentence.text);
    utterance.rate = rate;
    utterance.voice = voice;
    utterance.onend = () => {
      if (gen !== generation || !playing) return;
      index++;
      speakIndex(gen);
    };
    opts.synth.speak(utterance);
    emit();
  };

  return {
    play() {
      generation++;
      sentences = opts.getSentences();
      index = Math.max(index, 0);
      playing = true;
      speakIndex(generation);
    },
    pause() {
      opts.synth.pause();
      playing = false;
      emit();
    },
    resume() {
      opts.synth.resume();
      playing = true;
      emit();
    },
    stop() {
      generation++;
      opts.synth.cancel();
      playing = false;
      index = -1;
      sentences = [];
      opts.onSentence(null);
      emit();
    },
    setRate(r: number) {
      rate = r;
    },
    setVoice(v: TtsVoiceLike | null) {
      voice = v;
    },
    listVoices() {
      return opts.synth.getVoices();
    },
    getState,
  };
}
