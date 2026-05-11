import { test, expect } from '@playwright/test';

test.describe('parseAndSyncLists - hash-based skip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.evaluate(() => window.clearSyncHash());
    await page.waitForTimeout(100);
  });

  test('skips sync when called twice with identical config', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const config = {
        'test-list': [
          { pattern: 'example.com', pattern_type: 'domain' },
          { pattern: 'other.com', pattern_type: 'domain' }
        ]
      };

      await window.ListUtilities.parseAndSyncLists(config);
      const countAfterFirst = (await window.ListUtilities.getListEntries('test-list')).length;

      // Manually wipe backend entries — proves second call is a no-op
      await window.ListUtilities.deleteAllEntriesInList('test-list', 'backend');
      const countAfterDelete = (await window.ListUtilities.getListEntries('test-list')).length;

      await window.ListUtilities.parseAndSyncLists(config);
      const countAfterSecond = (await window.ListUtilities.getListEntries('test-list')).length;

      return { countAfterFirst, countAfterDelete, countAfterSecond };
    });

    expect(result.countAfterFirst).toBe(2);
    expect(result.countAfterDelete).toBe(0);
    expect(result.countAfterSecond).toBe(0); // second call was skipped
  });

  test('resyncs when config changes after a previous sync', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const configV1 = {
        'test-list': [{ pattern: 'example.com', pattern_type: 'domain' }]
      };
      const configV2 = {
        'test-list': [
          { pattern: 'example.com', pattern_type: 'domain' },
          { pattern: 'newsite.com', pattern_type: 'domain' }
        ]
      };

      await window.ListUtilities.parseAndSyncLists(configV1);
      const countV1 = (await window.ListUtilities.getListEntries('test-list')).length;

      await window.ListUtilities.parseAndSyncLists(configV2);
      const countV2 = (await window.ListUtilities.getListEntries('test-list')).length;

      return { countV1, countV2 };
    });

    expect(result.countV1).toBe(1);
    expect(result.countV2).toBe(2);
  });

  test('force option bypasses hash check and resyncs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const config = {
        'test-list': [{ pattern: 'example.com', pattern_type: 'domain' }]
      };

      await window.ListUtilities.parseAndSyncLists(config);
      await window.ListUtilities.deleteAllEntriesInList('test-list', 'backend');

      await window.ListUtilities.parseAndSyncLists(config, { force: true });
      return (await window.ListUtilities.getListEntries('test-list')).length;
    });

    expect(result).toBe(1);
  });

  test('hash is stable regardless of top-level key insertion order', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const configAB = {
        'a-list': [{ pattern: 'a.com', pattern_type: 'domain' }],
        'b-list': [{ pattern: 'b.com', pattern_type: 'domain' }]
      };
      const configBA = {
        'b-list': [{ pattern: 'b.com', pattern_type: 'domain' }],
        'a-list': [{ pattern: 'a.com', pattern_type: 'domain' }]
      };

      await window.ListUtilities.parseAndSyncLists(configAB);
      await window.ListUtilities.deleteAllEntriesInList('a-list', 'backend');
      await window.ListUtilities.deleteAllEntriesInList('b-list', 'backend');

      await window.ListUtilities.parseAndSyncLists(configBA);

      return {
        aCount: (await window.ListUtilities.getListEntries('a-list')).length,
        bCount: (await window.ListUtilities.getListEntries('b-list')).length
      };
    });

    // Both 0 — second call was skipped because hash matched despite different key order
    expect(result.aCount).toBe(0);
    expect(result.bCount).toBe(0);
  });

  test('does not write hash when no sync has occurred', async ({ page }) => {
    const result = await page.evaluate(async () => {
      return await window.getStoredSyncHash();
    });

    // Nothing has been synced — hash must be absent
    expect(result).toBeNull();
  });

  test('resetListDatabase clears the stored hash', async ({ page }) => {
    // Sync once to get a hash stored
    await page.evaluate(async () => {
      const config = { 'test-list': [{ pattern: 'example.com', pattern_type: 'domain' }] };
      await window.ListUtilities.parseAndSyncLists(config);
    });

    const hashAfterSync = await page.evaluate(() => window.getStoredSyncHash());
    expect(hashAfterSync).not.toBeNull();

    // Navigate away to close all IDB connections, then back to run resetListDatabase cleanly
    await page.goto('about:blank');
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);

    await page.evaluate(() => window.ListUtilities.resetListDatabase());
    await page.waitForTimeout(200);

    const hashAfterReset = await page.evaluate(() => window.getStoredSyncHash());
    expect(hashAfterReset).toBeNull();
  });
});
