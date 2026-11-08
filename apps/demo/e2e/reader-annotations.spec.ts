import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettingsSection } from './e2e-helpers.js';

test.describe('Pore.js demo — annotations & features', () => {
  test('annotations review: highlight in a sample, find it from the home screen, jump back', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('.landing__samples').getByRole('button', { name: /Novel/ }).click();
    const frame = page.frameLocator('iframe.pore-text__frame');
    const h1 = frame.locator('h1');
    await h1.waitFor();
    await h1.evaluate((el) => {
      const doc = el.ownerDocument!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    await page.locator('.selection-toolbar__swatch').first().click();
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Back to start' }).click();
    await page.getByRole('button', { name: 'My annotations' }).click();

    const review = page.getByRole('dialog', { name: 'My annotations' });
    await expect(review).toBeVisible();
    await expect(review.locator('.review__group-title')).toHaveText('Novel (EPUB)');
    await expect(review.locator('.review__row')).toHaveCount(1);

    await review.getByLabel('Filter annotations').fill('zzzznomatch');
    await expect(review.locator('.review__row')).toHaveCount(0);
    await review.getByLabel('Filter annotations').fill('');
    await expect(review.locator('.review__row')).toHaveCount(1);

    await review.locator('.review__jump').first().click();
    await expect(review).toBeHidden();
    await expect(page).toHaveURL(/[?&]book=demo-book/);
    const jumped = page.frameLocator('iframe.pore-text__frame');
    await expect(jumped.locator('h1')).toContainText('The Beginning', { timeout: 15_000 });
  });

  test('export / import: a highlight survives a wipe via the JSON bundle', async ({ page }) => {
    await page.goto('/');
    await page.locator('.landing__samples').getByRole('button', { name: /Novel/ }).click();
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    await frame.locator('h1').evaluate((el) => {
      const doc = el.ownerDocument!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    await page.locator('.selection-toolbar__swatch').first().click();
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Back to start' }).click();
    await page.getByRole('button', { name: 'My annotations' }).click();
    const review = page.getByRole('dialog', { name: 'My annotations' });

    await expect(review.locator('.review__group-export')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await review.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();

    await review.getByRole('button', { name: 'Close' }).click();
    await page.goto('/?book=demo-book');
    await page.getByRole('button', { name: 'Highlights' }).click();
    await page.locator('[data-pore-hl-remove]').first().click();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Highlights' })).not.toContainText('1');

    await page.getByRole('button', { name: 'Back to start' }).click();
    await page.getByRole('button', { name: 'My annotations' }).click();
    await review.locator('input[type="file"]').setInputFiles(path!);
    await expect(review.locator('.review__notice')).toContainText('1 highlight');

    await page.goto('/?book=demo-book');
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');
  });

  test('share a passage: copy a page link, open it fresh, it lands + pulses', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.addInitScript(() => {
      let buf = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) => ((buf = t), Promise.resolve()),
          readText: () => Promise.resolve(buf),
        },
      });
    });
    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Copy a link to this page' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/[?&]book=demo-book/);
    expect(link).toMatch(/[?&]cfi=/);

    await page.goto(link);
    await expect(page.locator('.reader-host--pulse')).toBeVisible();
    await expect(page).toHaveURL(/book=demo-book/);
    await expect(page).not.toHaveURL(/cfi=/);
    await expect(page.locator('.reader-host--pulse')).toHaveCount(0, { timeout: 4000 });
  });

  test('annotations review is axe clean and keyboard-reachable (light + dark)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('.landing__samples').getByRole('button', { name: /Novel/ }).click();
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    await frame.locator('h1').evaluate((el) => {
      const doc = el.ownerDocument!;
      const r = doc.createRange();
      r.selectNodeContents(el);
      const s = doc.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    await page.locator('.selection-toolbar__swatch').first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Back to start' }).click();

    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.goto('/');
      await page.getByRole('button', { name: 'My annotations' }).click();
      const review = page.getByRole('dialog', { name: 'My annotations' });
      await expect(review).toBeVisible();

      await review.getByLabel('Filter annotations').focus();
      await expect(review.locator('.review__group-export')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .include('.review')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(serious, `${dark ? 'dark' : 'light'}: ${JSON.stringify(serious, null, 2)}`).toEqual(
        [],
      );

      await review.getByRole('button', { name: 'Close' }).click();
      await expect(review).toBeHidden();
    }
  });

  test('PDF rect highlight: Shift-drag a passage, it persists across reload', async ({ page }) => {
    await page.goto('/?book=demo-pdf');
    const img = page.locator('.pore-image__viewport img');
    await expect(img).toBeVisible();
    await expect
      .poll(async () => (await img.boundingBox())!.width, { timeout: 15_000 })
      .toBeGreaterThan(200);
    const box = (await img.boundingBox())!;

    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.09);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.11, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await page
      .getByRole('button', { name: /Highlight in/ })
      .first()
      .click();
    await expect(page.locator('.pore-pdf-hl__box')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');

    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.locator('.pore-pdf-hl__box')).toHaveCount(1);
    await page.getByRole('button', { name: 'Highlights' }).click();
    await expect(page.locator('[data-pore-hl-jump]').first()).toContainText('Lorem');
  });

  test('bookmark: add with "b", turn pages, jump back to it, survives reload', async ({ page }) => {
    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    const reader = page.locator('.pore-text');
    const pct = async () => Number((await page.locator('.loc').textContent())!.match(/(\d+)%/)![1]);

    for (let i = 0; i < 6; i++) await reader.press('ArrowRight');
    const marked = await pct();
    await reader.press('b');
    await expect(page.getByRole('button', { name: 'Bookmarks' })).toContainText('1');

    for (let i = 0; i < 6; i++) await reader.press('ArrowRight');
    expect(await pct()).toBeGreaterThan(marked + 3);

    await page.getByRole('button', { name: 'Bookmarks' }).click();
    await page.locator('[data-pore-bm-jump]').first().click();
    await expect.poll(pct).toBeLessThanOrEqual(marked + 2);

    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Bookmarks' })).toContainText('1');
  });

  test('highlight persists across reload and click-to-jump works', async ({ page }) => {
    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    const h1 = frame.locator('h1');
    await h1.waitFor();
    await h1.evaluate((el) => {
      const doc = el.ownerDocument!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    const swatch = page.locator('.selection-toolbar__swatch').first();
    await expect(swatch).toBeVisible();
    await swatch.click();
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');

    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Highlights' })).toContainText('1');

    await page.getByRole('button', { name: 'Highlights' }).click();
    await page.locator('[data-pore-hl-jump]').first().click();
    await expect(frame.locator('h1')).toContainText('The Beginning');
  });

  test('highlight note: add via the panel, edit, survives reload', async ({ page }) => {
    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    await frame.locator('h1').evaluate((el) => {
      const doc = el.ownerDocument!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Highlight and add a note' }).click();
    const note = page.locator('[data-pore-hl-note]').first();
    await note.fill('remember this bit');
    await note.blur();
    await page.waitForTimeout(1000);

    await page.reload();
    await page.getByRole('button', { name: 'Highlights' }).click();
    await expect(page.locator('[data-pore-hl-note]').first()).toHaveValue('remember this bit');

    await page.locator('[data-pore-hl-swatch]').nth(1).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole('button', { name: 'Highlights' }).click();
    await expect(page.locator('[data-pore-hl-swatch]').nth(1)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('OPDS catalog: browse the bundled fixture and open a book', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page.getByRole('button', { name: 'Browse OPDS catalog' }).click();
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(page.locator('.opds-browser__list li')).toHaveCount(3);
    await page
      .locator('.opds-browser__list li', { hasText: 'Fixed-Layout' })
      .getByRole('button', { name: 'Open' })
      .click();
    await expect(page.frameLocator('iframe.pore-text__frame').locator('h1')).toContainText(
      'A Good Morning',
    );
  });

  test('text-to-speech: play shows the current sentence, pause/resume toggles', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'no SpeechSynthesis in this browser build');
    await page.goto('/?book=demo-book');
    await page.getByRole('button', { name: 'Text to speech' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.tts-bar__sentence')).not.toHaveText('');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  });

  test('M4 UI (highlights, OPDS, TTS) has no critical/serious axe violations', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page.locator('iframe.pore-text__frame').waitFor();
    await page.getByRole('button', { name: 'Highlights' }).click();
    await page.getByRole('button', { name: 'Browse OPDS catalog' }).click();
    await page.getByRole('button', { name: 'Text to speech' }).click();
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

  test('M5 UI (menu-bar settings, note editor, highlights panel) is axe clean & keyboard-reachable', async ({
    page,
  }) => {
    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();

    await frame.locator('h1').evaluate((el) => {
      const doc = el.ownerDocument!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.locator('.selection-toolbar')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Highlight and add a note' }).click();
    const note = page.locator('[data-pore-hl-note]').first();
    await note.focus();
    await page.keyboard.type('keyboard note');
    await expect(note).toHaveValue('keyboard note');

    await openSettingsSection(page, 'Menu bar');
    await expect(page.getByRole('button', { name: 'Right', exact: true })).toBeVisible();

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
});
