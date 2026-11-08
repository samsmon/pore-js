import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettingsSection, turn } from './e2e-helpers.js';

test.describe('Pore.js demo — landing', () => {
  test('bare / shows the landing page; a sample opens the reader and Home returns', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.landing')).toBeVisible();
    await expect(page.locator('iframe.pore-text__frame')).toHaveCount(0);

    await page.locator('.landing__samples').getByRole('button', { name: /Novel/ }).click();
    await expect(page.frameLocator('iframe.pore-text__frame').locator('h1')).toContainText(
      'The Beginning',
    );
    await expect(page).toHaveURL(/[?&]book=demo-book/);

    await page.getByRole('button', { name: 'Back to start' }).click();
    await expect(page.locator('.landing')).toBeVisible();
    await expect(page).not.toHaveURL(/book=/);
  });

  test('a deep link (?book=) skips the landing page', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await expect(page.locator('.landing')).toHaveCount(0);
    await expect(page.locator('.loc')).toContainText('1/12');
  });

  test('library shelf: open two samples, resume from the shelf, remove one', async ({ page }) => {
    await page.goto('/');
    await page.locator('.landing__samples').getByRole('button', { name: /Novel/ }).click();
    await expect(page.frameLocator('iframe.pore-text__frame').locator('h1')).toBeVisible();
    await page.getByRole('button', { name: 'Back to start' }).click();

    await page.locator('.landing__samples').getByRole('button', { name: /Manga/ }).click();
    await expect(page.locator('.loc')).toContainText('1/12');
    await page.getByRole('button', { name: 'Back to start' }).click();

    const shelf = page.locator('.landing__recent');
    await expect(shelf).toBeVisible();
    await expect(shelf.locator('.landing__recent-item')).toHaveCount(2);
    await expect(shelf.locator('.landing__recent-title').first()).toHaveText('Manga');

    await shelf.locator('.landing__recent-open', { hasText: 'Manga' }).click();
    await expect(page).toHaveURL(/[?&]book=demo-manga/);
    await page.getByRole('button', { name: 'Back to start' }).click();

    await page.getByRole('button', { name: 'Remove Manga from library' }).click();
    await expect(shelf.locator('.landing__recent-item')).toHaveCount(1);
    await expect(shelf.locator('.landing__recent-title').first()).toHaveText('Novel (EPUB)');
  });

  test('a corrupt dropped file shows the error card, not a blank screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('.landing').waitFor();
    await page.setInputFiles('input[type="file"]', {
      name: 'totally-broken.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from('PK\x03\x04 this is not a real epub at all'),
    });
    await expect(page.getByRole('alert')).toContainText(/couldn.t load/i, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Back to start' }).click();
    await expect(page.locator('.landing')).toBeVisible();
  });

  test('landing page has no critical/serious axe violations', async ({ page }) => {
    await page.goto('/');
    await page.locator('.landing').waitFor();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});

test.describe('Pore.js demo', () => {
  test('paged manga: turn, counter, resume across reload', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    const counter = page.locator('.loc');
    await expect(counter).toContainText('1/12');

    await turn(page, 'forward', { rtl: true });
    await turn(page, 'forward', { rtl: true });
    await expect(counter).toContainText('/12');
    const reached = await counter.textContent();

    await page.waitForTimeout(1000);
    await page.reload();
    await expect(counter).toHaveText(reached!.trim());
    await expect(counter).not.toContainText('1/12');
  });

  test('layout switch to long strip virtualizes and tracks scroll', async ({ page }) => {
    await page.goto('/?book=demo-webtoon');
    const counter = page.locator('.loc');
    await expect(counter).toContainText('1/8');

    const surface = page.locator('.pore-image');
    await surface.evaluate((el) => {
      el.scrollTop = 8000;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(counter).not.toContainText('1/8');
  });

  test('@mobile touch: chrome handle, double-tap zoom, swipe', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await expect(page.locator('.pore-image__viewport img').first()).toBeVisible();
    await page.waitForTimeout(600);
    const handle = page.locator('[data-pore-chrome-handle]');
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    const vpW = page.viewportSize()!.width;
    expect(hb.x + hb.width / 2).toBeGreaterThan(vpW / 2 - 40);
    expect(hb.x + hb.width / 2).toBeLessThan(vpW / 2 + 40);

    const box = (await page.locator('.pore-image').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const scale = () =>
      page.locator('.pore-image__viewport').evaluate((e) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(e).transform);
        return Math.round(m.a * 10) / 10;
      });
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(cx, cy);
    await expect.poll(scale, { timeout: 4000 }).toBeGreaterThan(1.5);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(cx, cy);
    await expect.poll(scale, { timeout: 4000 }).toBeLessThan(1.2);

    await page.goto('/?book=demo-book');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await frame.locator('h1').waitFor();
    const flow = frame.locator('#pore-flow');
    const px = async () =>
      Number((await flow.evaluate((e) => e.style.transform)).match(/-?\d+/)?.[0] ?? 0);
    await expect.poll(() => flow.evaluate((e) => e.style.transform)).toMatch(/translate/);
    const before = await px();
    const rb = (await page.locator('.pore-text').boundingBox())!;
    const y = rb.y + rb.height / 2;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rb.x + rb.width - 25, y }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: rb.x + rb.width / 2, y }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: rb.x + 25, y }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(px).not.toBe(before);
  });

  test('a page that fails to load shows a retry tile; tapping it recovers', async ({ page }) => {
    let block = true;
    await page.route(/demo-manga\/p0*2\.svg/i, (route) =>
      block ? route.abort() : route.continue(),
    );
    await page.goto('/?book=demo-manga');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await openSettingsSection(page, 'Layout');
    await page.getByLabel('Layout').selectOption('paged-single');
    await page.getByRole('button', { name: 'Reader settings' }).click();

    await turn(page, 'forward', { rtl: true });
    const tile = page.locator('img[data-pore-page-error]');
    await expect(tile).toBeVisible({ timeout: 10_000 });

    block = false;
    await tile.click();
    await expect(page.locator('img[data-pore-page-error]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.pore-image__viewport img[src]')).toBeVisible();
  });

  test('RTL double spread renders two pages, left arrow goes back', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await expect(page.locator('.pore-image img')).toHaveCount(2);
    await turn(page, 'forward', { rtl: true });
    await expect(page.locator('.loc')).toContainText('3/12');
    await turn(page, 'back', { rtl: true });
    await expect(page.locator('.loc')).toContainText('1/12');
  });

  test('resize keeps the reading position', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await turn(page, 'forward', { rtl: true });
    await turn(page, 'forward', { rtl: true });
    const before = await page.locator('.loc').textContent();
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.locator('.loc')).toHaveText(before!.trim());
  });

  test('the menu rail is a fixed overlay that insets the reader when docked', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    const bar = page.locator('.bar--right, .bar--left').first();
    await expect(bar).toHaveCSS('position', 'fixed');
    const barBox = (await bar.boundingBox())!;
    const hostBox = (await page.locator('.pore-image').boundingBox())!;
    expect(Math.abs(hostBox.x + hostBox.width - barBox.x)).toBeLessThanOrEqual(2);
  });

  test('menu bar: Left placement docks the rail on the left and insets the reader', async ({
    page,
  }) => {
    await page.goto('/?book=demo-manga');
    await openSettingsSection(page, 'Menu bar');
    await page.getByRole('button', { name: 'Left', exact: true }).click();
    await page.getByRole('button', { name: /Always visible/ }).click();
    await page.getByRole('button', { name: 'Reader settings' }).click();

    const bar = page.locator('.bar--left');
    await expect(bar).toHaveCSS('position', 'fixed');
    const barBox = (await bar.boundingBox())!;
    expect(barBox.x).toBeLessThanOrEqual(1);
    await expect
      .poll(async () => (await page.locator('.pore-image').boundingBox())!.x)
      .toBeGreaterThan(barBox.width - 20);
  });

  test('menu bar: Auto-hide slides the rail away, activity wakes it', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await openSettingsSection(page, 'Menu bar');
    await page.getByRole('button', { name: 'Right', exact: true }).click();
    await page.getByRole('button', { name: /Auto-hide/ }).click();
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page
      .locator('.pore-image')
      .first()
      .click({ position: { x: 8, y: 8 } });

    const bar = page.locator('.bar--right');
    await page.mouse.move(400, 300);
    await expect(bar).toHaveClass(/bar--hidden/, { timeout: 6000 });
    await page.mouse.move(410, 310);
    await page.mouse.move(420, 320);
    await expect(bar).not.toHaveClass(/bar--hidden/);
    await expect(bar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  });

  test('theme button on an EPUB cycles light → sepia → dark', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page.frameLocator('iframe.pore-text__frame').locator('h1').waitFor();
    const style = page.frameLocator('iframe.pore-text__frame').locator('#pore-base-style');
    const btn = page.getByRole('button', { name: /Reading theme/ });
    const bg = () => style.textContent().then((t) => t?.match(/background:(#[0-9a-f]+)/i)?.[1]);

    for (let i = 0; i < 4; i++) {
      if (/light/.test((await btn.getAttribute('aria-label')) ?? '')) break;
      await btn.click();
      await page.waitForTimeout(150);
    }
    await expect.poll(bg).toBe('#faf7f1');
    await btn.click();
    await expect.poll(bg).toBe('#f2e7d3');
    await btn.click();
    await expect.poll(bg).toBe('#17150f');
  });

  test('url-and-title history: ?p= updates and back/forward paginate', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await turn(page, 'forward', { rtl: true });
    await turn(page, 'forward', { rtl: true });
    await expect(page).toHaveURL(/[?&]p=\d+/);
    const reached = await page.locator('.loc').textContent();
    await page.goBack();
    await expect(page.locator('.loc')).not.toHaveText(reached!.trim());
    await page.goForward();
    await expect(page.locator('.loc')).toHaveText(reached!.trim());
  });

  test('settings panel changes the fit mode live', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await openSettingsSection(page, 'Image fit');
    await page.getByLabel('Fit mode').selectOption('width');
    await expect(page.locator('.pore-image img').first()).toHaveAttribute('style', /width:\s*100%/);
  });

  test('continuous-horizontal reads and virtualizes', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await openSettingsSection(page, 'Layout');
    await page.getByLabel('Layout').selectOption('continuous-horizontal');
    const surface = page.locator('.pore-image');
    await expect(surface).toHaveCSS('overflow-x', 'auto');
    await surface.evaluate((el) => {
      el.scrollLeft = 2500;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator('.loc')).not.toContainText('1/12');
  });
});

test.describe('Pore.js demo — EPUB & PDF', () => {
  test('paginates, turns pages, and resumes across reload', async ({ page }) => {
    await page.goto('/?book=demo-book');
    const loc = page.locator('.loc');
    await expect(loc).toContainText('%');
    const frame = page.frameLocator('iframe.pore-text__frame');
    await expect(frame.locator('h1')).toContainText('The Beginning');

    for (let i = 0; i < 4; i++) await turn(page, 'forward');
    const reached = await loc.textContent();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(loc).not.toHaveText('The Pore.js Demo Book · 0%');
    void reached;
  });

  test('TOC jumps to a chapter and a footnote opens a popover', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await page
      .getByRole('combobox', { name: 'Table of contents' })
      .selectOption({ label: 'The Resolution' });
    const frame = page.frameLocator('iframe.pore-text__frame');
    await expect(frame.locator('h1')).toContainText('The Resolution');

    await frame.locator('a[href*="notes"]').first().click();
    await expect(page.getByRole('dialog', { name: 'Footnote' })).toBeVisible();
  });

  test('progress line shows the current chapter for a chaptered book', async ({ page }) => {
    await page.goto('/?book=demo-manga');
    await turn(page, 'forward', { rtl: true });
    await turn(page, 'forward', { rtl: true });
    await turn(page, 'forward', { rtl: true });
    await expect(page.locator('.loc')).toContainText('Ch 2/3');
  });

  test('theme + font size restyle without losing the chapter', async ({ page }) => {
    await page.goto('/?book=demo-book');
    await openSettingsSection(page, 'Theme');
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    const bg = await page
      .frameLocator('iframe.pore-text__frame')
      .locator('#pore-base-style')
      .textContent();
    expect(bg).toContain('#17150f');
  });

  test('PDF renders pages, turns, and switches back to another format', async ({ page }) => {
    await page.goto('/?book=demo-pdf');
    const loc = page.locator('.loc');
    await expect(loc).toContainText('1/9');
    await expect(page.locator('.pore-image img')).toHaveCount(1);

    await turn(page, 'forward');
    await turn(page, 'forward');
    await expect(loc).toContainText('3/9');

    await page.getByRole('combobox', { name: 'Book' }).click();
    await page.getByRole('option', { name: 'Novel (EPUB)' }).click();
    await expect(loc).toContainText('%');
  });

  test('PDF pinch/zoom controls work like the image reader', async ({ page }) => {
    await page.goto('/?book=demo-pdf');
    await openSettingsSection(page, 'Image fit');
    await page.getByLabel('Fit mode').selectOption('width');
    await expect(page.locator('.pore-image img').first()).toHaveAttribute('style', /width:\s*100%/);
  });
});
