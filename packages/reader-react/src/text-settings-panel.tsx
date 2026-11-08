import { useState } from 'react';
import type { TextEngineSettings } from 'porejs';
import { useReaderSettings } from './reader.js';
import {
  Accordion,
  SelectField,
  SliderField,
  SwitchField,
  Tabs,
  type TabDef,
} from './primitives.js';

/** The Text/Theme/Navigation section set for an EPUB or PDF — tabs, or a stacked accordion for narrow chrome. */
export function TextSettingsPanel({
  trailing,
  extraTabs = [],
  layout = 'tabs',
}: {
  trailing?: React.ReactNode;
  extraTabs?: TabDef[];
  layout?: 'tabs' | 'accordion';
}) {
  const [s, set] = useReaderSettings<TextEngineSettings>();
  const [tab, setTab] = useState('text');

  const tabs: TabDef[] = [
    {
      id: 'text',
      label: 'Text',
      content: (
        <>
          <SelectField
            label="Font"
            value={s.fontFamily}
            onValueChange={(fontFamily) => set({ fontFamily })}
            options={[
              { value: 'original', label: "Publisher's" },
              { value: 'serif', label: 'Literata (serif)' },
              { value: 'sans', label: 'Hanken Grotesk (sans)' },
              { value: 'slab', label: 'Slab serif' },
              { value: 'dyslexic', label: 'OpenDyslexic' },
            ]}
          />
          <SliderField
            label="Font size"
            min={70}
            max={220}
            step={5}
            value={s.fontSizePct}
            onValueChange={(fontSizePct) => set({ fontSizePct })}
            format={(v) => `${v}%`}
          />
          <SliderField
            label="Line height"
            min={1}
            max={2.4}
            step={0.05}
            value={s.lineHeight}
            onValueChange={(lineHeight) => set({ lineHeight })}
            format={(v) => v.toFixed(2)}
          />
          <SwitchField
            label="Justify text"
            checked={s.textAlign === 'justify'}
            onCheckedChange={(j) => set({ textAlign: j ? 'justify' : 'start' })}
          />
          <SliderField
            label="Margin"
            min={0}
            max={16}
            value={s.marginPct}
            onValueChange={(marginPct) => set({ marginPct })}
            format={(v) => `${v}%`}
          />
          <SelectField
            label="Columns"
            value={String(s.columns) as '1' | '2'}
            onValueChange={(c) => set({ columns: Number(c) as 1 | 2 })}
            options={[
              { value: '1', label: 'One' },
              { value: '2', label: 'Two' },
            ]}
          />
          <SwitchField
            label="Publisher styles"
            checked={s.publisherStyles}
            onCheckedChange={(publisherStyles) => set({ publisherStyles })}
          />
        </>
      ),
    },
    {
      id: 'theme',
      label: 'Theme',
      content: (
        <>
          <SelectField
            label="Theme"
            value={s.theme}
            onValueChange={(theme) => set({ theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'dark', label: 'Dark' },
              { value: 'oled', label: 'OLED black' },
            ]}
          />
          <SwitchField
            label="Dim images (dark themes)"
            checked={s.dimImages}
            onCheckedChange={(dimImages) => set({ dimImages })}
          />
        </>
      ),
    },
    {
      id: 'nav',
      label: 'Navigation',
      content: (
        <>
          <SelectField
            label="Reading mode"
            value={s.flowMode}
            onValueChange={(flowMode) => set({ flowMode })}
            options={[
              { value: 'paged', label: 'Paged' },
              { value: 'flow', label: 'Flow (scroll, a11y)' },
              { value: 'auto', label: 'Auto (high-contrast → flow)' },
            ]}
          />
          <SelectField
            label="Vertical text"
            value={s.verticalText}
            disabled={s.flowMode === 'flow'}
            onValueChange={(verticalText) => set({ verticalText })}
            options={[
              { value: 'auto', label: 'Auto (from book)' },
              { value: 'on', label: 'Always on' },
              { value: 'off', label: 'Always off' },
            ]}
          />
          <SelectField
            label="At chapter end"
            value={s.endBehavior}
            onValueChange={(endBehavior) => set({ endBehavior })}
            options={[
              { value: 'continuous', label: 'Continue to next' },
              { value: 'endpage', label: 'Show end page' },
            ]}
          />
        </>
      ),
    },
    ...extraTabs,
  ];

  if (layout === 'accordion') return <Accordion items={tabs} />;
  return (
    <Tabs tabs={tabs} value={tab} onValueChange={setTab} {...(trailing ? { trailing } : {})} />
  );
}
