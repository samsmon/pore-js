// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import React, { useState } from 'react';

afterEach(cleanup);
import {
  ReaderPositionContext,
  ReaderConfigContext,
  ReaderUIContext,
  ReaderAnnotationsContext,
  useReaderLocation,
  useReaderSettings,
  useChromeVisible,
  useReaderHighlights,
  type ReaderPositionCtx,
  type ReaderConfigCtx,
  type ReaderUICtx,
  type ReaderAnnotationsCtx,
} from './reader.js';

describe('PERF-01: Partition RuntimeContext', () => {
  it('re-renders only position consumers on location/progress change', () => {
    let positionRenderCount = 0;
    let configRenderCount = 0;
    let uiRenderCount = 0;
    let annotationsRenderCount = 0;

    function PositionConsumer() {
      useReaderLocation();
      positionRenderCount++;
      return <div data-testid="position-consumer" />;
    }

    function ConfigConsumer() {
      useReaderSettings();
      configRenderCount++;
      return <div data-testid="config-consumer" />;
    }

    function UIConsumer() {
      useChromeVisible();
      uiRenderCount++;
      return <div data-testid="ui-consumer" />;
    }

    function AnnotationsConsumer() {
      useReaderHighlights();
      annotationsRenderCount++;
      return <div data-testid="annotations-consumer" />;
    }

    let setLocationExternal!: (page: number) => void;

    function TestProvider({ children }: { children: React.ReactNode }) {
      const [pos, setPos] = useState<ReaderPositionCtx>({
        location: { position: { type: 'page', value: 0 }, page: 0, total: 10, percent: 0, label: '1/10' },
        progress: null,
      });
      setLocationExternal = (page: number) => {
        setPos({
          location: { position: { type: 'page', value: page }, page, total: 10, percent: page / 9, label: `${page + 1}/10` },
          progress: null,
        });
      };

      const [config] = useState<ReaderConfigCtx>({
        handle: {
          turn: () => {},
          goto: () => {},
          goToHref: () => {},
          setSettings: () => {},
          setKeymap: () => {},
          chapters: () => [],
          search: async () => [],
          gotoHit: () => {},
          getCfi: () => null,
          goToCfi: () => {},
          addHighlight: () => null,
          removeHighlight: () => {},
          updateHighlight: () => null,
          listHighlights: () => [],
          ttsPlay: () => {},
          ttsPause: () => {},
          ttsResume: () => {},
          ttsStop: () => {},
          ttsSetRate: () => {},
          ttsSetVoice: () => {},
          ttsListVoices: () => [],
        },
        source: {} as never,
        bookId: 'test-book',
        kind: 'image',
        manifest: null,
        settings: {} as never,
        keymap: {} as never,
        toc: [],
        chapters: [],
      });

      const [ui] = useState<ReaderUICtx>({
        chromeVisible: true,
        footnote: null,
        clearFootnote: () => {},
        endPage: null,
        resumedFromPage: null,
        loading: false,
        error: null,
        clearError: () => {},
      });

      const [annotations] = useState<ReaderAnnotationsCtx>({
        highlights: [],
        selection: null,
        ttsState: null,
      });

      return (
        <ReaderConfigContext.Provider value={config}>
          <ReaderUIContext.Provider value={ui}>
            <ReaderAnnotationsContext.Provider value={annotations}>
              <ReaderPositionContext.Provider value={pos}>
                {children}
              </ReaderPositionContext.Provider>
            </ReaderAnnotationsContext.Provider>
          </ReaderUIContext.Provider>
        </ReaderConfigContext.Provider>
      );
    }

    render(
      <TestProvider>
        <PositionConsumer />
        <ConfigConsumer />
        <UIConsumer />
        <AnnotationsConsumer />
      </TestProvider>,
    );

    expect(positionRenderCount).toBe(1);
    expect(configRenderCount).toBe(1);
    expect(uiRenderCount).toBe(1);
    expect(annotationsRenderCount).toBe(1);

    // Simulate page turn or continuous scroll update
    act(() => {
      setLocationExternal(1);
    });

    // Position consumer re-rendered
    expect(positionRenderCount).toBe(2);
    // Config, UI, and Annotations consumers did NOT re-render!
    expect(configRenderCount).toBe(1);
    expect(uiRenderCount).toBe(1);
    expect(annotationsRenderCount).toBe(1);

    // Simulate another scroll event
    act(() => {
      setLocationExternal(2);
    });

    expect(positionRenderCount).toBe(3);
    expect(configRenderCount).toBe(1);
    expect(uiRenderCount).toBe(1);
    expect(annotationsRenderCount).toBe(1);
  });
});
