import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Turn the page from the keyboard or edge tap-zone. `rtl` flips the arrow for
 * right-to-left books (manga, Arabic, vertical-JP), where forward is ArrowLeft.
 */
export async function turn(
  page: Page,
  dir: 'forward' | 'back' = 'forward',
  opts: { rtl?: boolean } = {},
) {
  await page.locator('.pore-image img, iframe.pore-text__frame').first().waitFor();
  const image = page.locator('.pore-image');
  const loc = page.locator('.loc');
  const before = await loc.textContent().catch(() => null);

  const go = async () => {
    if ((await image.count()) > 0) {
      const box = (await image.boundingBox())!;
      const forwardRight = !opts.rtl;
      const toRight = dir === 'forward' ? forwardRight : !forwardRight;
      await page.mouse.click(box.x + box.width * (toRight ? 0.85 : 0.15), box.y + box.height / 2);
    } else {
      const key =
        dir === 'forward'
          ? opts.rtl
            ? 'ArrowLeft'
            : 'ArrowRight'
          : opts.rtl
            ? 'ArrowRight'
            : 'ArrowLeft';
      await page.locator('.pore-text').press(key);
    }
  };

  await go();
  await expect
    .poll(() => loc.textContent().catch(() => null), { timeout: 2000 })
    .not.toBe(before)
    .catch(go);
}

/** axe on the demo chrome (never the publisher iframe); fail on serious+. */
export async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude('iframe.pore-text__frame')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['region'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

/**
 * Open the settings rail and expand one accordion section (Text / Theme /
 * Navigation / Layout / Image fit / Behavior / Menu bar).
 */
export async function openSettingsSection(page: Page, section: string) {
  const trigger = page.getByRole('button', { name: 'Reader settings' });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const summary = page.locator('[data-pore-accordion-summary]', { hasText: section });
  await summary.waitFor();
  if ((await summary.getAttribute('data-state')) !== 'open') await summary.click();
  await expect(summary).toHaveAttribute('data-state', 'open');
}
