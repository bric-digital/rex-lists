import { test, expect } from '@playwright/test';

test.describe('List replacement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);

    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('a reader never sees a list empty while it is replaced', async ({ page }) => {
    const counts = await page.evaluate(async () => {
      const entry = (i) => ({ pattern: `site${i}.com`, pattern_type: 'domain' });
      const first = Array.from({ length: 500 }, (_, i) => entry(i));
      await window.ListUtilities.mergeBackendList('big', first);

      const seen = [];
      const replacing = window.ListUtilities.mergeBackendList('big', first);
      let done = false;
      replacing.then(() => { done = true; });

      while (done === false) {
        seen.push((await window.ListUtilities.getListEntries('big')).length);
      }

      return seen;
    });

    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((count) => count === 500)).toBe(true);
  });

  test('a user entry with the same pattern is replaced by the backend entry', async ({ page }) => {
    const entries = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'mixed',
        pattern: 'site1.com',
        pattern_type: 'domain',
        source: 'user',
        metadata: {}
      });

      await window.ListUtilities.mergeBackendList('mixed', [
        { pattern: 'site1.com', pattern_type: 'domain' }
      ]);

      return window.ListUtilities.getListEntries('mixed');
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('backend');
  });

  test('a user entry with a different pattern survives the merge', async ({ page }) => {
    const entries = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'mixed',
        pattern: 'mine.com',
        pattern_type: 'domain',
        source: 'user',
        metadata: {}
      });

      await window.ListUtilities.mergeBackendList('mixed', [
        { pattern: 'site1.com', pattern_type: 'domain' }
      ]);

      return window.ListUtilities.getListEntries('mixed');
    });

    const bySource = entries.map((entry) => `${entry.source}:${entry.pattern}`).sort();
    expect(bySource).toEqual(['backend:site1.com', 'user:mine.com']);
  });
});
