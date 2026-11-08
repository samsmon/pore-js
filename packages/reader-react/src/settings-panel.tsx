import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { DEFAULT_KEYMAP, type ActionId, type ImageEngineSettings } from 'porejs';
import { useReaderKeymap, useReaderKind, useReaderSettings } from './reader.js';
import { TextSettingsPanel } from './text-settings-panel.js';
import {
  Accordion,
  SelectField,
  SliderField,
  SwitchField,
  Tabs,
  type TabDef,
} from './primitives.js';

const ACTION_LABELS: Record<ActionId, string> = {
  'toggle-menu': 'Toggle menu',
  'page-right': 'Turn page right',
  'page-left': 'Turn page left',
  'scroll-up': 'Scroll up',
  'scroll-down': 'Scroll down',
  'chapter-forward': 'Next chapter',
  'chapter-back': 'Previous chapter',
  'toggle-fullscreen': 'Fullscreen',
  'cycle-fit': 'Cycle fit mode',
  'toggle-spread-offset': 'Offset double spreads',
  'first-page': 'First page',
  'last-page': 'Last page',
  'toggle-autoscroll': 'Toggle autoscroll',
};

/** Rebind-by-capture editor for the image keymap. */
function KeybindEditor() {
  const [keymap, setKeymap] = useReaderKeymap();
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  return (
    <>
      {(Object.keys(ACTION_LABELS) as ActionId[]).map((action) => (
        <div className="pore-settings__row" data-pore-field key={action}>
          <span>{ACTION_LABELS[action]}</span>
          <span className="pore-settings__keys" data-pore-keys>
            {(keymap[action] ?? []).map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
            <button
              type="button"
              className={capturing === action ? 'active' : ''}
              onClick={() => setCapturing(action)}
              onKeyDown={(e) => {
                if (capturing !== action) return;
                e.preventDefault();
                const keys = Array.from(new Set([...(keymap[action] ?? []), e.key])).slice(0, 4);
                setKeymap({ [action]: keys });
                setCapturing(null);
              }}
            >
              {capturing === action ? 'press a key…' : '+'}
            </button>
            <button type="button" onClick={() => setKeymap({ [action]: DEFAULT_KEYMAP[action] })}>
              reset
            </button>
          </span>
        </div>
      ))}
      <div className="pore-settings__row">
        <button type="button" onClick={() => setKeymap(DEFAULT_KEYMAP)}>
          Reset all keybinds
        </button>
      </div>
    </>
  );
}

function ImageSettingsPanel({
  trailing,
  extraTabs = [],
  layout = 'tabs',
}: {
  trailing?: ReactNode;
  extraTabs?: TabDef[];
  layout?: 'tabs' | 'accordion';
}) {
  const [s, set] = useReaderSettings<ImageEngineSettings>();
  const tabs: TabDef[] = [
    {
      id: 'layout',
      label: 'Layout',
      content: (
        <>
          <SelectField
            label="Layout"
            value={s.layout}
            onValueChange={(layout) => set({ layout })}
            options={[
              { value: 'paged-single', label: 'Single page' },
              { value: 'paged-double', label: 'Double page' },
              { value: 'continuous-vertical', label: 'Long strip' },
              { value: 'continuous-horizontal', label: 'Wide strip' },
            ]}
          />
          <SelectField
            label="Direction"
            value={s.direction}
            onValueChange={(direction) => set({ direction })}
            options={[
              { value: 'ltr', label: 'Left to right' },
              { value: 'rtl', label: 'Right to left' },
              { value: 'vertical', label: 'Vertical' },
            ]}
          />
          <SwitchField
            label="Offset double spreads"
            checked={!!s.spreadOffset}
            onCheckedChange={(v) => set({ spreadOffset: v ? 1 : 0 })}
          />
          <SliderField
            label="Page gap"
            min={0}
            max={60}
            value={s.pageGap}
            onValueChange={(pageGap) => set({ pageGap })}
            format={(v) => `${v}px`}
          />
          <SelectField
            label="Background"
            value={s.background}
            onValueChange={(background) => set({ background })}
            options={[
              { value: 'theme', label: 'Theme' },
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
            ]}
          />
          <SelectField
            label="Progress bar"
            value={s.progressBar.style}
            onValueChange={(style) => set({ progressBar: { ...s.progressBar, style } })}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'lightbar', label: 'Lightbar' },
              { value: 'hidden', label: 'Hidden' },
            ]}
          />
        </>
      ),
    },
    {
      id: 'fit',
      label: 'Image fit',
      content: (
        <>
          <SelectField
            label="Fit mode"
            value={s.fit}
            onValueChange={(fit) => set({ fit })}
            options={[
              { value: 'contain', label: 'Contain' },
              { value: 'width', label: 'Fit width' },
              { value: 'height', label: 'Fit height' },
              { value: 'original', label: 'Original size' },
              { value: 'smart', label: 'Smart' },
            ]}
          />
          <SwitchField
            label="Stretch small pages"
            checked={s.stretchSmallPages}
            onCheckedChange={(stretchSmallPages) => set({ stretchSmallPages })}
          />
          <SliderField
            label="Max width"
            min={0}
            max={2400}
            step={100}
            value={s.maxWidth ?? 0}
            onValueChange={(v) => set({ maxWidth: v || null })}
            format={(v) => (v ? `${v}px` : 'none')}
          />
          <SliderField
            label="Brightness"
            min={0.3}
            max={1}
            step={0.05}
            value={s.brightness}
            onValueChange={(brightness) => set({ brightness })}
            format={(v) => v.toFixed(2)}
          />
          <SwitchField
            label="Greyscale"
            checked={s.greyscale}
            onCheckedChange={(greyscale) => set({ greyscale })}
          />
          <SwitchField label="Dim" checked={s.dim} onCheckedChange={(dim) => set({ dim })} />
        </>
      ),
    },
    {
      id: 'behavior',
      label: 'Behavior',
      content: (
        <>
          <SelectField
            label="Tap edges to turn"
            value={s.tapToTurn}
            onValueChange={(tapToTurn) => set({ tapToTurn })}
            options={[
              { value: 'directional', label: 'Directional' },
              { value: 'always-forward', label: 'Always forward' },
              { value: 'never', label: 'Never' },
            ]}
          />
          <SelectField
            label="Wheel in paged mode"
            value={s.scrollToTurn}
            onValueChange={(scrollToTurn) => set({ scrollToTurn })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'wheel', label: 'Turn pages' },
              { value: 'both', label: 'Turn pages + keys' },
            ]}
          />
          <SwitchField
            label="Double-click fullscreen"
            checked={s.doubleClickFullscreen}
            onCheckedChange={(doubleClickFullscreen) => set({ doubleClickFullscreen })}
          />
          <SelectField
            label="Loading method"
            value={s.loadingMethod}
            onValueChange={(loadingMethod) => set({ loadingMethod })}
            options={[
              { value: 'native', label: 'Native' },
              { value: 'blob', label: 'Blob' },
              { value: 'bitmap', label: 'Bitmap (canvas)' },
            ]}
          />
          <SelectField
            label="Preload"
            value={s.preloadStrategy}
            onValueChange={(preloadStrategy) => set({ preloadStrategy })}
            options={[
              { value: 'window', label: 'Around current page' },
              { value: 'all', label: 'Whole chapter' },
            ]}
          />
          <SliderField
            label="Autoscroll speed"
            min={10}
            max={200}
            value={s.autoscrollSpeed}
            onValueChange={(autoscrollSpeed) => set({ autoscrollSpeed })}
            format={(v) => `${v} px/s`}
          />
          <SwitchField
            label="Smooth autoscroll"
            checked={s.autoscrollSmooth}
            onCheckedChange={(autoscrollSmooth) => set({ autoscrollSmooth })}
          />
          <SliderField
            label="Paged auto-advance"
            min={0}
            max={20}
            value={s.pagedAutoAdvanceSeconds}
            onValueChange={(pagedAutoAdvanceSeconds) => set({ pagedAutoAdvanceSeconds })}
            format={(v) => (v ? `${v}s` : 'off')}
          />
          <SelectField
            label="Next chapter after last page"
            value={String(s.nextChapterAfterLastPage) as 'off' | 'instant' | '3' | '5' | '10'}
            onValueChange={(v) =>
              set({
                nextChapterAfterLastPage:
                  v === 'off' || v === 'instant' ? v : (Number(v) as 3 | 5 | 10),
              })
            }
            options={[
              { value: 'off', label: 'Off' },
              { value: 'instant', label: 'Instant' },
              { value: '3', label: '3s' },
              { value: '5', label: '5s' },
              { value: '10', label: '10s' },
            ]}
          />
        </>
      ),
    },
    { id: 'keys', label: 'Keybinds', content: <KeybindEditor /> },
    ...extraTabs,
  ];

  const [tab, setTab] = useState('layout');
  if (layout === 'accordion') return <Accordion items={tabs} />;
  return (
    <Tabs tabs={tabs} value={tab} onValueChange={setTab} {...(trailing ? { trailing } : {})} />
  );
}

/**
 * The settings section set for the current book kind — no dialog chrome.
 * `layout="accordion"` renders stacked `<details>` sections instead of a tab
 * strip (for narrow chrome like a sidebar rail).
 */
export function SettingsPanelBody({
  trailing,
  extraTabs,
  layout,
}: {
  trailing?: ReactNode;
  /** Extra tabs appended after the built-in ones (e.g. an app's own settings). */
  extraTabs?: TabDef[];
  layout?: 'tabs' | 'accordion';
}) {
  const kind = useReaderKind();
  const props = {
    ...(trailing ? { trailing } : {}),
    ...(extraTabs ? { extraTabs } : {}),
    ...(layout ? { layout } : {}),
  };
  return kind === 'text' ? <TextSettingsPanel {...props} /> : <ImageSettingsPanel {...props} />;
}

export interface SettingsPanelProps {
  /** Controlled open state. Omit both to render inline (no dialog). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Back-compat: called when the close button is pressed. */
  onClose?: () => void;
  /** Element that opens the dialog (wrapped in `Dialog.Trigger asChild`). */
  trigger?: ReactNode;
  /** Extra tabs appended after the built-in ones. */
  extraTabs?: TabDef[];
  className?: string;
}

/**
 * Reader settings. With `open`/`onOpenChange` (or a `trigger`) it is a Radix
 * modal `Dialog` with a focus trap; otherwise it renders the tab set inline.
 * Both paths use Radix `Tabs` and the headless field primitives.
 */
export function SettingsPanel({
  open,
  onOpenChange,
  onClose,
  trigger,
  extraTabs,
  className,
}: SettingsPanelProps) {
  const controlled = open !== undefined || onOpenChange !== undefined || trigger !== undefined;
  // Restore focus to whatever opened the dialog on close — Radix does this
  // for its own `Dialog.Trigger`, but the common case here is a controlled
  // `open` prop with an external toggle button and no trigger.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }, [open]);
  const close = (
    <Dialog.Close
      className="pore-settings__close"
      aria-label="Close"
      data-pore-dialog-close
      onClick={onClose}
    >
      ×
    </Dialog.Close>
  );

  if (!controlled) {
    return (
      <div className={className ?? 'pore-settings'} role="group" aria-label="Reader settings">
        <SettingsPanelBody
          {...(extraTabs ? { extraTabs } : {})}
          trailing={
            onClose ? (
              <button
                type="button"
                className="pore-settings__close"
                aria-label="Close"
                onClick={onClose}
              >
                ×
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <Dialog.Root
      {...(open !== undefined ? { open } : {})}
      onOpenChange={(o) => {
        onOpenChange?.(o);
        if (!o) onClose?.();
      }}
    >
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="pore-settings__overlay" data-pore-dialog-overlay />
        <Dialog.Content
          className={className ?? 'pore-settings'}
          data-pore-dialog
          aria-label="Reader settings"
          onCloseAutoFocus={(e) => {
            if (!trigger && restoreFocusRef.current?.isConnected) {
              e.preventDefault();
              restoreFocusRef.current.focus();
            }
          }}
        >
          <Dialog.Title className="pore-sr-only">Reader settings</Dialog.Title>
          <SettingsPanelBody trailing={close} {...(extraTabs ? { extraTabs } : {})} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
