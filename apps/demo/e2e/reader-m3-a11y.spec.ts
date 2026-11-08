import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectAxeClean, openSettingsSection, turn } from './e2e-helpers.js';

test.describe('Pore.js demo — M3 & Accessibility', () => {
  test('vertical-JP EPUB reads right-to-left', async ({ page }) => {
    await page.goto('/?book=demo-vertical');
    const css = await page
      .frameLocator('iframe.pore-text__frame')
      .locator('#pore-base-style')
      .textContent();
    expect(css).toContain('writing-mode:vertical-rl');

    const loc = page.locator('.loc');
    await expect(loc).toContainText('%');
    const flow = page.frameLocator('iframe.pore-text__frame').locator('#pore-flow');
    await expect.poll(() => flow.evaluate((el) => el.style.transform)).toMatch(/translate/);
    const before = await flow.evaluate((el) => el.style.transform);
    await page.locator('.pore-text').press('ArrowLeft');
    await expect
      .poll(() => flow.evaluate((el) => el.style.transform), { timeout: 8000 })
      .not.toBe(before);
  });

  test('RTL-horizontal (Arabic) EPUB: multicol, direction, key swap', async ({ page }) => {
    await page.goto('/?book=demo-rtl');
    const css = await page
      .frameLocator('iframe.pore-text__frame')
      .locator('#pore-base-style')
      .textContent();
    expect(css).not.toContain('writing-mode:vertical-rl');
    expect(css).toContain('direction:rtl');

    const flow = page.frameLocator('iframe.pore-text__frame').locator('#pore-flow');
    const before = await flow.evaluate((el) => el.style.transform);
    await page.locator('.pore-text').press('ArrowLeft');
    await expect.poll(() => flow.evaluate((el) => el.style.transform)).toMatch(/translate\(-\d/);
    expect(await flow.evaluate((el) => el.style.transform)).not.toBe(before);
  });

  test('flow mode turns the reader into a semantic scroller', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await openSettingsSection(page, 'Navigation');
    await page.getByLabel('Reading mode').selectOption('flow');
    await page.getByRole('button', { name: 'Reader settings' }).click();

    const vp = page.frameLocator('iframe.pore-text__frame').locator('#pore-viewport');
    await expect(vp).toHaveCSS('overflow-y', 'auto');
    const loc = page.locator('.loc');
    const start = await loc.textContent();
    await page.locator('.pore-text').press('ArrowDown');
    await expect(loc).not.toHaveText(start!.trim());
  });

  test('in-book search jumps between hits', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.getByPlaceholder('Search in book…').fill('consequat');
    const hits = page.locator('.search__hits li button');
    await expect(hits.first()).toBeVisible();
    await hits.nth(3).click();
    await expect(page.locator('.search__count')).toContainText('/');
  });

  test('reader has no critical axe violations (keyboard + ARIA)', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page.locator('iframe.pore-text__frame').waitFor();
    await expectAxeClean(page);
  });

  test('dark theme: the chrome is still axe clean (contrast on the dark palette)', async ({
    page,
  }) => {
    await page.goto('/?book=demo-manga');
    await page.getByRole('button', { name: /theme/i }).first().click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Reader settings' }).click();
    const results = await new AxeBuilder({ page })
      .exclude('iframe.pore-text__frame')
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test('keyboard: chrome is fully traversable, Esc closes a panel and restores focus', async ({
    page,
  }) => {
    await page.goto('/?book=demo-book');
    await page.locator('iframe.pore-text__frame').waitFor();

    for (const name of ['Back to start', 'Search in book', 'Highlights', 'Reader settings']) {
      await page.getByRole('button', { name }).focus();
      await expect(page.getByRole('button', { name })).toBeFocused();
    }

    const hl = page.getByRole('button', { name: 'Highlights' });
    await hl.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Highlights' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Highlights' })).toBeHidden();
    await expect(hl).toBeFocused();

    await page.locator('.pore-text').focus();
    const loc = page.locator('.loc');
    const before = await loc.textContent();
    await page.keyboard.press('ArrowRight');
    await expect(loc).not.toHaveText(before!.trim());
  });

  test('forced-colors (Windows High Contrast): chrome stays outlined and axe clean', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/?book=demo-book');
    await page.locator('iframe.pore-text__frame').waitFor();
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await expect(page.locator('.bar__settings-inline')).toBeVisible();
    const border = await page.locator('.bar').evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).not.toBe('0px');
    const results = await new AxeBuilder({ page })
      .exclude('iframe.pore-text__frame')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['region', 'color-contrast'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test('settings accordion: sections expand one at a time, controls reachable, axe clean', async ({
    page,
  }) => {
    await page.goto('/?book=demo-book');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    const rail = page.locator('.bar__settings-inline');
    await expect(rail).toBeVisible();

    await openSettingsSection(page, 'Navigation');
    await expect(
      page.locator('[data-pore-accordion-summary]', { hasText: 'Text' }),
    ).toHaveAttribute('data-state', 'closed');
    await expect(page.getByLabel('Reading mode')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.bar')
      .exclude('iframe.pore-text__frame')
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region'])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);

    await page.getByRole('button', { name: 'Reader settings' }).click();
    await expect(rail).toBeHidden();
  });

  test('bottom scrubber seeks and shows chapter ticks', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await turn(page, 'forward', { rtl: true });
    await page.mouse.move(400, 300);
    const slider = page.getByRole('slider', { name: 'Seek' });
    await expect(slider).toBeVisible();
    await expect(page.locator('.pore-scrubber__tick')).toHaveCount(2);

    const track = page.locator('.pore-scrubber__track');
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.03, box.y + box.height / 2);
    await expect(page.locator('.loc')).toContainText('Ch 3/3');
    await expect(page.locator('[data-pore-scrubber-label]')).toContainText('%');
  });

  test('fixed-layout EPUB pages one spine per turn, scaled to fit the window', async ({ page }) => {
    await page.goto('/?book=demo-fixed');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await expect(frame.locator('h1')).toContainText('A Good Morning');
    await turn(page, 'forward');
    await expect(frame.locator('h1')).toContainText('The Long Walk');
    const flow = frame.locator('#pore-flow');
    await expect(flow).toHaveCSS('width', '750px');
  });

  test('reduced motion: page turns apply instantly', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/?book=demo-book');
    const flow = page.frameLocator('iframe.pore-text__frame').locator('#pore-flow');
    await flow.waitFor();
    await page.locator('.pore-text').press('ArrowRight');
    await expect.poll(() => flow.evaluate((el) => el.style.transform)).toMatch(/translateX\(-\d/);
    await context.close();
  });
});
