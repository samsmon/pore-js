import type { ImageManifest } from '../source/types.js';
import type { ImageEngineSettings } from '../settings/types.js';
import type { TurnDirection } from '../types.js';

export interface ImageAutoNavCoordinatorOptions {
  isContinuous: () => boolean;
  prefersReducedMotion: () => boolean;
  getSettings: () => ImageEngineSettings;
  getManifest: () => ImageManifest | null;
  getCurrentPage: () => number;
  scrollMain: () => number;
  setScrollMain: (v: number) => void;
  viewportMain: () => number;
  turn: (dir: TurnDirection) => void;
  goto: (target: number) => void;
  onScroll: () => void;
  emitAutoscroll: (running: boolean) => void;
  emitAutoAdvance: (payload: { toChapter: string | null; inMs: number }) => void;
  emitEnd: (payload: { auto: ImageEngineSettings['nextChapterAfterLastPage'] }) => void;
}

/**
 * Coordinates continuous autoscroll and paged auto-advance timers.
 */
export class ImageAutoNavCoordinator {
  #opts: ImageAutoNavCoordinatorOptions;
  #autoOn = false;
  #autoRaf = 0;
  #autoLastT = 0;
  #autoStepTimer: ReturnType<typeof setInterval> | null = null;
  #autoPagedTimer: ReturnType<typeof setInterval> | null = null;
  #autoResumeTimer: ReturnType<typeof setTimeout> | null = null;
  #advanceTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  constructor(opts: ImageAutoNavCoordinatorOptions) {
    this.#opts = opts;
  }

  get isRunning(): boolean {
    return this.#autoOn;
  }

  #autoStep = (t: number): void => {
    if (!this.#autoOn || this.#destroyed) return;
    const dt = this.#autoLastT ? (t - this.#autoLastT) / 1000 : 0;
    this.#autoLastT = t;
    const before = this.#opts.scrollMain();
    const speed = this.#opts.getSettings().autoscrollSpeed;
    this.#opts.setScrollMain(before + speed * dt);
    if (this.#opts.scrollMain() === before) {
      // hit the end
      this.stopAutoscroll();
      this.#opts.turn('forward');
      return;
    }
    this.#opts.onScroll();
    this.#autoRaf = requestAnimationFrame(this.#autoStep);
  };

  startAutoscroll(): void {
    if (this.#autoOn || !this.#opts.isContinuous() || this.#opts.prefersReducedMotion()) return;
    this.#autoOn = true;
    this.#autoLastT = 0;
    this.#opts.emitAutoscroll(true);
    const settings = this.#opts.getSettings();
    if (settings.autoscrollSmooth) {
      this.#autoRaf = requestAnimationFrame(this.#autoStep);
    } else {
      const stepMs = (this.#opts.viewportMain() / Math.max(settings.autoscrollSpeed, 1)) * 1000;
      this.#autoStepTimer = setInterval(() => this.#opts.turn('forward'), stepMs);
    }
  }

  stopAutoscroll(silent = false): void {
    if (!this.#autoOn) return;
    this.#autoOn = false;
    if (this.#autoRaf) cancelAnimationFrame(this.#autoRaf);
    this.#autoRaf = 0;
    if (this.#autoStepTimer) clearInterval(this.#autoStepTimer);
    this.#autoStepTimer = null;
    if (!silent) this.#opts.emitAutoscroll(false);
  }

  pauseAutoscroll(): void {
    if (!this.#autoOn) return;
    this.stopAutoscroll(true);
    if (this.#autoResumeTimer) clearTimeout(this.#autoResumeTimer);
    this.#autoResumeTimer = setTimeout(() => {
      if (!this.#destroyed && this.#opts.getSettings().autoscroll) this.startAutoscroll();
    }, 2000);
  }

  startPagedAutoAdvance(): void {
    const settings = this.#opts.getSettings();
    if (this.#autoPagedTimer || settings.pagedAutoAdvanceSeconds <= 0 || this.#opts.isContinuous()) return;
    this.#autoPagedTimer = setInterval(
      () => this.#opts.turn('forward'),
      settings.pagedAutoAdvanceSeconds * 1000,
    );
  }

  stopPagedAutoAdvance(): void {
    if (this.#autoPagedTimer) {
      clearInterval(this.#autoPagedTimer);
      this.#autoPagedTimer = null;
    }
  }

  cancelAutoAdvance(): void {
    if (this.#advanceTimer) {
      clearTimeout(this.#advanceTimer);
      this.#advanceTimer = null;
      this.#opts.emitAutoAdvance({ toChapter: null, inMs: -1 });
    }
  }

  armChapterAdvance(target: { id: string; startIndex: number }): void {
    const settings = this.#opts.getSettings();
    if (settings.nextChapterAfterLastPage === 'off') {
      this.#opts.goto(target.startIndex);
      return;
    }
    const secs =
      settings.nextChapterAfterLastPage === 'instant' ? 0 : settings.nextChapterAfterLastPage;
    this.#opts.emitAutoAdvance({ toChapter: target.id, inMs: secs * 1000 });
    this.#advanceTimer = setTimeout(() => {
      this.#advanceTimer = null;
      this.#opts.goto(target.startIndex);
    }, secs * 1000);
  }

  chapterIndexOf(page: number): number {
    const chs = this.#opts.getManifest()?.chapters;
    if (!chs?.length) return 0;
    let idx = 0;
    for (let i = 0; i < chs.length; i++) if (chs[i]!.startIndex <= page) idx = i;
    return idx;
  }

  interceptChapterBoundary(nextPage: number): boolean {
    const manifest = this.#opts.getManifest();
    if (!manifest?.chapters?.length) return false;
    const ci = this.chapterIndexOf(this.#opts.getCurrentPage());
    const ni = this.chapterIndexOf(nextPage);
    if (ni <= ci) return false;
    const target = manifest.chapters[ni]!;
    this.#opts.emitEnd({ auto: this.#opts.getSettings().nextChapterAfterLastPage });
    this.armChapterAdvance(target);
    return true;
  }

  destroy(): void {
    this.#destroyed = true;
    this.stopAutoscroll(true);
    this.stopPagedAutoAdvance();
    this.cancelAutoAdvance();
    if (this.#autoResumeTimer) clearTimeout(this.#autoResumeTimer);
  }
}
