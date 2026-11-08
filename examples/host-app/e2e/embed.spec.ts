import { expect, test, type Page } from '@playwright/test';

/** Turn the page by clicking a tap-zone (the engine reads direction itself). */
async function turn(page: Page, dir: 'forward' | 'back', rtl: boolean) {
  const box = (await page.locator('.pore-image').boundingBox())!;
  const forwardLeft = rtl;
  const toLeft = dir === 'forward' ? forwardLeft : !forwardLeft;
  await page.mouse.click(box.x + box.width * (toLeft ? 0.12 : 0.88), box.y + box.height / 2);
  await page.waitForTimeout(200);
}

/**
 * Proves porejs embeds cleanly in a host app: the host supplies a `ReaderSource`
 * and a mount point, and gets a working reader — pages turn, progress persists
 * through the host's own storage, the host owns the tab title, and opening a
 * second book doesn't inherit the first one's state.
 */

test('open a volume, read, resume through the host source', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inkwell' })).toBeVisible();

  await page.locator('button[data-book="tidepool-v2"]').click();
  await expect(page.locator('.pore-image img').first()).toBeVisible();

  // the host composed the tab title from the manifest porejs handed it
  await expect(page).toHaveTitle('Tidepool · Vol. 2 · The Spring Tide — Inkwell');

  await turn(page, 'forward', true); // Tidepool is RTL
  await turn(page, 'forward', true);
  await turn(page, 'forward', true);
  await expect(page).toHaveTitle(/\(\d+%\)/); // percent appears once we've moved

  await page.waitForTimeout(600); // debounced saveProgress
  const titleBefore = await page.title();

  // progress went to the host's OWN namespace; porejs-react's settings store
  // uses `pore:*` — they never collide
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toContain('inkwell:progress:tidepool-v2');
  expect(keys.some((k) => k.startsWith('pore:settings:'))).toBe(true);

  // reload → back at the library (the host owns routing); re-open → the host's
  // loadProgress() resumes us where we were
  await page.reload();
  await page.locator('button[data-book="tidepool-v2"]').click();
  await expect(page.locator('.pore-image img').first()).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.title()).toBe(titleBefore);
});

test("a second book does not inherit the first book's state", async ({ page }) => {
  await page.goto('/');
  await page.locator('button[data-book="tidepool-v1"]').click();
  await expect(page.locator('.pore-image img').first()).toBeVisible();
  await turn(page, 'forward', true);
  await turn(page, 'forward', true);
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: '← Library' }).click();
  await page.locator('button[data-book="emberline-v1"]').click();
  await expect(page.locator('.pore-image img').first()).toBeVisible();

  // Emberline (LTR) is a fresh book — page 1, no percent in the title yet
  await expect(page).toHaveTitle('Emberline · Vol. 1 · Kindling — Inkwell');
});

test('the reader ships no CSS of its own', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[data-book="emberline-v1"]').click();
  await expect(page.locator('.pore-image').first()).toBeVisible();
  const sheets = await page.evaluate(() =>
    [...document.styleSheets]
      .map((s) => s.href)
      .filter(Boolean)
      .map(String),
  );
  // only the host's own bundle — nothing injected from porejs / porejs-react
  expect(sheets.every((h) => !/porejs/.test(h))).toBe(true);
});
